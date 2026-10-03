import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { getDeck } from "@/lib/deck/store";
import { pptxResponse } from "@/lib/pptx/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/decks/:id/export: the member's deck as a PowerPoint file. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/decks/[id]/export">
) {
  const user = await getSession();
  if (!user) return Response.json({ error: "sign in first" }, { status: 401 });
  const { id } = await params;
  const deck = await getDeck(sql, user.sub, id);
  if (!deck) return Response.json({ error: "no such deck" }, { status: 404 });
  return pptxResponse(sql, deck);
}
