// Server only: a .pptx made into a new deck of the member's, its pictures
// stored as the member's assets. Shared by the upload route and MCP.
import type postgres from "postgres";

import { saveAsset } from "../assets/store";
import { createDeck } from "../deck/store";
import { emitErrorLog } from "../otel/log";
import { inSpan } from "../otel/span";
import type { ImportReport } from "./import";
import { ImportBusyError, importInWorker } from "./pool";

export type ImportedDeck =
  | { ok: true; deckId: string; report: ImportReport }
  | { ok: false; code: string; status: 413 | 422 | 503 };

/**
 * Reads the file in a worker of its own. Pictures are checked there but
 * stored only once all of it has been, so a file that fails part way leaves
 * none behind. `source` names the caller in error logs.
 */
export async function importDeck(
  db: postgres.Sql,
  sub: string,
  bytes: Uint8Array,
  options: { fallbackTitle?: string; source: string }
): Promise<ImportedDeck> {
  return inSpan("import pptx", { "pptx.bytes": bytes.length }, async (set) => {
    let outcome: Awaited<ReturnType<typeof importInWorker>>;
    try {
      outcome = await importInWorker({
        bytes,
        fallbackTitle: options.fallbackTitle,
      });
    } catch (error) {
      if (!(error instanceof ImportBusyError)) throw error;
      set({ "import.outcome": error.reason });
      // An import that runs out of time is too much file; a full queue is not.
      return error.reason === "busy"
        ? { ok: false, code: "busy", status: 503 }
        : { ok: false, code: "too-large", status: 413 };
    }
    if (!outcome.ok) {
      set({ "import.outcome": outcome.code });
      // Anything the importer trips over is the file's fault, not the server's.
      if (outcome.bug) {
        // Logged as an error: it may be a bug in the importer, not the file.
        console.error("import: the importer failed on a file", outcome.bug);
        emitErrorLog(new Error(outcome.bug.split("\n")[0]), {
          "exception.stacktrace": outcome.bug,
          "http.route": options.source,
        });
      }
      return {
        ok: false,
        code: outcome.code,
        status: outcome.code === "too-large" ? 413 : 422,
      };
    }
    for (const [, image] of outcome.pictures) {
      await saveAsset(db, sub, image);
    }
    const imported = outcome.result;
    const deck = await createDeck(db, sub, imported.document);
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
    return { ok: true, deckId: deck.id, report: imported.report };
  });
}
