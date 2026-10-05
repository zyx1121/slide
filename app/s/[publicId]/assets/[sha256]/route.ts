import { documentAssets } from "@/lib/assets/drawn";
import { readAsset } from "@/lib/assets/store";
import { sql } from "@/lib/db";
import { getPublishedDeck } from "@/lib/deck/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /s/:publicId/assets/:sha256: a picture of a published deck. Only one
 * the deck draws (on a slide or in its layouts' artwork) and its owner
 * uploaded or its master ships with; unpublishing the deck ends access.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/s/[publicId]/assets/[sha256]">
) {
  const { publicId, sha256 } = await params;
  const deck = await getPublishedDeck(sql, publicId);
  const drawn = deck && documentAssets(deck.document).includes(sha256);
  const asset =
    deck && drawn ? await readAsset(sql, deck.ownerSub, sha256) : null;
  if (!asset) return Response.json({ error: "no such image" }, { status: 404 });
  return new Response(new Uint8Array(asset.data), {
    headers: {
      "content-type": asset.mime,
      // Short, so unpublishing ends access within a minute.
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
