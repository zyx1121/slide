import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { IMPORT_MAX_BYTES } from "@/lib/deck/limits";
import { readCapped, sameSite } from "@/lib/http/request";
import { importDeck } from "@/lib/pptx/import-deck";

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

  const result = await importDeck(sql, user.sub, bytes, {
    fallbackTitle: fallback,
    source: "/api/decks/import",
  });
  return result.ok
    ? Response.json(
        { id: result.deckId, report: result.report },
        { status: 201 }
      )
    : Response.json({ error: result.code }, { status: result.status });
}
