import { slideAssetUris } from "@/lib/assets/store";
import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { getDeck } from "@/lib/deck/store";
import {
  backgroundDataUri,
  RenderBusyError,
  renderPngAsync,
} from "@/lib/render/png";
import { renderSlideSvg } from "@/lib/render/svg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/decks/:id/slides/:n: slide n (1-based) of the member's deck as PNG. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/decks/[id]/slides/[n]">
) {
  const user = await getSession();
  if (!user) return Response.json({ error: "sign in first" }, { status: 401 });
  const { id, n } = await params;
  // Slide numbers are written plainly: 1, 2, 3, not 01 or 0x1.
  const index = /^[1-9][0-9]{0,3}$/.test(n) ? Number(n) - 1 : -1;
  const deck = index >= 0 ? await getDeck(sql, user.sub, id) : null;
  const slide = deck?.document.slides[index];
  if (!deck || !slide) {
    return Response.json({ error: "no such slide" }, { status: 404 });
  }
  const assets = await slideAssetUris(sql, user.sub, slide);
  const svg = renderSlideSvg(slide, {
    slideNumber: index + 1,
    background: backgroundDataUri(),
    assetHref: (sha256) => assets.get(sha256) ?? null,
  });
  let png: Buffer;
  try {
    png = await renderPngAsync(svg);
  } catch (error) {
    if (!(error instanceof RenderBusyError)) throw error;
    return Response.json(
      { error: "rendering is busy, try again" },
      { status: 503, headers: { "retry-after": "5" } }
    );
  }
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, no-store",
    },
  });
}
