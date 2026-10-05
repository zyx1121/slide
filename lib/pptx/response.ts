// Server only: a deck as a .pptx download, with the pictures its owner
// uploaded embedded. Shared by the member's export and the public page's.
import type postgres from "postgres";

import { readAsset } from "../assets/store";
import type { Deck } from "../deck/store";
import { readMasterFile } from "../master/store";
import { inSpan } from "../otel/span";
import { exportPptx, type Media } from "./export";

/** A file name for the deck's title: no path separators or control characters. */
export function fileName(title: string): string {
  // eslint-disable-next-line no-control-regex
  const safe = title.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ").trim();
  return `${safe || "slides"}.pptx`;
}

/** The deck as .pptx bytes, with its owner's pictures embedded. */
export async function pptxBytes(
  db: postgres.Sql,
  deck: Deck
): Promise<Uint8Array> {
  // The owner's own pictures are embedded; any other shows as a frame.
  const media = new Map<string, Media>();
  const shas = new Set(
    deck.document.slides.flatMap((slide) =>
      slide.shapes.flatMap((shape) =>
        shape.kind === "image" ? [shape.asset] : []
      )
    )
  );
  for (const sha256 of shas) {
    const asset = await readAsset(db, deck.ownerSub, sha256);
    if (asset) media.set(sha256, { mime: asset.mime, data: asset.data });
  }
  const master = await readMasterFile(db, deck.document.master.file);
  if (!master)
    throw new Error(`master file ${deck.document.master.file} is missing`);
  const bytes = await inSpan(
    "export pptx",
    {
      "export.slides": deck.document.slides.length,
      "export.pictures": media.size,
    },
    (set) => {
      const out = exportPptx(deck.document, media, master);
      set({ "export.bytes": out.length });
      return out;
    }
  );
  return bytes;
}

/** The deck as a PowerPoint download. */
export async function pptxResponse(
  db: postgres.Sql,
  deck: Deck
): Promise<Response> {
  const bytes = await pptxBytes(db, deck);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="slides.pptx"; filename*=UTF-8''${encodeURIComponent(fileName(deck.title))}`,
      "cache-control": "private, no-store",
    },
  });
}
