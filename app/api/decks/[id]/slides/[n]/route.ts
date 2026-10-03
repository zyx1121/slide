import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { getDeck } from "@/lib/deck/store";
import { backgroundDataUri, renderPng } from "@/lib/render/png";
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
  const svg = renderSlideSvg(slide, {
    slideNumber: index + 1,
    background: backgroundDataUri(),
    // Image assets arrive with #11; until then pictures render as placeholders.
    assetHref: () => null,
  });
  return new Response(new Uint8Array(renderPng(svg)), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, no-store",
    },
  });
}
