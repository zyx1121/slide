import { saveAsset } from "@/lib/assets/store";
import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { IMPORT_MAX_BYTES } from "@/lib/deck/limits";
import { createDeck } from "@/lib/deck/store";
import { readCapped, sameSite } from "@/lib/http/request";
import { emitErrorLog } from "@/lib/otel/log";
import { inSpan } from "@/lib/otel/span";
import { ImportBusyError, importInWorker } from "@/lib/pptx/pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/decks/import: the request body, a .pptx, as a new deck of the
 * member's. Pictures are stored as the member's assets. Answers the deck's
 * id and a report of what was left out. Only from this site's own pages.
 */
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return Response.json({ error: "sign in first" }, { status: 401 });
  if (!sameSite(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (Number(request.headers.get("content-length")) > IMPORT_MAX_BYTES) {
    return Response.json({ error: "too-large" }, { status: 413 });
  }
  const bytes = await readCapped(request.body, IMPORT_MAX_BYTES);
  if (!bytes) return Response.json({ error: "too-large" }, { status: 413 });

  // The file's name, sent percent-encoded, titles a deck that has none.
  let name = "";
  try {
    name = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  } catch {
    name = "";
  }
  const fallback = name.replace(/\.pptx$/i, "").trim() || undefined;

  // The file is read in a worker of its own. Pictures are checked there but
  // stored only once all of it has been, so a file that fails part way
  // leaves none behind.
  return inSpan("import pptx", { "pptx.bytes": bytes.length }, async (set) => {
    let outcome: Awaited<ReturnType<typeof importInWorker>>;
    try {
      outcome = await importInWorker({ bytes, fallbackTitle: fallback });
    } catch (error) {
      if (!(error instanceof ImportBusyError)) throw error;
      set({ "import.outcome": error.reason });
      // An import that runs out of time is too much file; a full queue is not.
      return error.reason === "busy"
        ? Response.json({ error: "busy" }, { status: 503 })
        : Response.json({ error: "too-large" }, { status: 413 });
    }
    if (!outcome.ok) {
      set({ "import.outcome": outcome.code });
      // Anything the importer trips over is the file's fault, not the server's.
      if (outcome.bug) {
        // Logged as an error: it may be a bug in the importer, not the file.
        console.error("import: the importer failed on a file", outcome.bug);
        emitErrorLog(new Error(outcome.bug.split("\n")[0]), {
          "exception.stacktrace": outcome.bug,
          "http.route": "/api/decks/import",
        });
      }
      return Response.json(
        { error: outcome.code },
        { status: outcome.code === "too-large" ? 413 : 422 }
      );
    }
    for (const [, image] of outcome.pictures) {
      await saveAsset(sql, user.sub, image);
    }
    const imported = outcome.result;
    const deck = await createDeck(sql, user.sub, imported.document);
    // Counts only: what the file held and what was left out, by kind.
    const skipped = imported.report.skipped;
    set({
      "import.outcome": "ok",
      "import.slides": imported.document.slides.length,
      "import.shapes": imported.report.shapes,
      "import.pictures": outcome.pictures.length,
      "import.skipped": Object.values(skipped).reduce((a, b) => a + b, 0),
      // Kinds can carry a file's own names (shape presets): kept short.
      "import.skipped_kinds": Object.keys(skipped)
        .sort()
        .join(",")
        .slice(0, 300),
    });
    return Response.json(
      { id: deck.id, report: imported.report },
      { status: 201 }
    );
  });
}
