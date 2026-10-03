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
  const deck = await getDeck(sql, user.sub, id);
  const index = Number(n) - 1;
  const slide =
    Number.isInteger(index) && index >= 0
      ? deck?.document.slides[index]
      : undefined;
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
