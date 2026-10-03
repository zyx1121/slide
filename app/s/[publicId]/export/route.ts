import { sql } from "@/lib/db";
import { getPublishedDeck } from "@/lib/deck/store";
import { pptxResponse } from "@/lib/pptx/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /s/:publicId/export: a published deck as a PowerPoint file, for anyone. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/s/[publicId]/export">
) {
  const { publicId } = await params;
  const deck = await getPublishedDeck(sql, publicId);
  if (!deck) return Response.json({ error: "no such deck" }, { status: 404 });
  return pptxResponse(sql, deck);
}
