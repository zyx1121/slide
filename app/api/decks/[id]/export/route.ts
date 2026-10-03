import { readAsset } from "@/lib/assets/store";
import { getSession } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { getDeck } from "@/lib/deck/store";
import { exportPptx, type Media } from "@/lib/pptx/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A file name for the deck's title: no path separators or control characters. */
function fileName(title: string): string {
  // eslint-disable-next-line no-control-regex
  const safe = title.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ").trim();
  return `${safe || "slides"}.pptx`;
}

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
  // The member's own pictures are embedded; any other shows as a frame.
  const media = new Map<string, Media>();
  const shas = new Set(
    deck.document.slides.flatMap((slide) =>
      slide.shapes.flatMap((shape) =>
        shape.kind === "image" ? [shape.asset] : []
      )
    )
  );
  for (const sha256 of shas) {
    const asset = await readAsset(sql, user.sub, sha256);
    if (asset) media.set(sha256, { mime: asset.mime, data: asset.data });
  }
  const bytes = exportPptx(deck.document, media);
  const name = fileName(deck.title);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="slides.pptx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
    },
  });
}
