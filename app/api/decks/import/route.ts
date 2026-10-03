import { AssetError, saveAsset } from "@/lib/assets/store";
import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { IMPORT_MAX_BYTES } from "@/lib/deck/limits";
import { createDeck } from "@/lib/deck/store";
import { readCapped, sameSite } from "@/lib/http/request";
import { importPptx } from "@/lib/pptx/import";
import { PptxError } from "@/lib/pptx/read";

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

  let imported: Awaited<ReturnType<typeof importPptx>>;
  try {
    imported = await importPptx(
      bytes,
      async (image) => {
        try {
          const asset = await saveAsset(sql, user.sub, image);
          return { sha256: asset.sha256 };
        } catch (error) {
          if (error instanceof AssetError) return null;
          throw error;
        }
      },
      fallback
    );
  } catch (error) {
    // Anything the importer trips over is the file's fault, not the server's.
    const code = error instanceof PptxError ? error.code : "malformed";
    if (!(error instanceof PptxError)) {
      // Logged as an error: it may be a bug in the importer, not the file.
      console.error("import: the importer failed on a file", error);
    }
    return Response.json(
      { error: code },
      { status: code === "too-large" ? 413 : 422 }
    );
  }
  const deck = await createDeck(sql, user.sub, imported.document);
  return Response.json(
    { id: deck.id, report: imported.report },
    { status: 201 }
  );
}
