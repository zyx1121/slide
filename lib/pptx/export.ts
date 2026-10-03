// Server only: a deck as a .pptx file. The WinLab template supplies the
// master, its layouts and theme, untouched; its sample slides are replaced
// by the deck's, each on the "Title & Bullets" layout, so the title and the
// slide number land in the master's placeholders.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type { DeckDocument } from "../deck/schema";
import { esc, slideXml } from "./slide";

/** The layout every exported slide uses: "Title & Bullets". */
const LAYOUT = "../slideLayouts/slideLayout2.xml";

const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SLIDE_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
};

export type Media = { mime: string; data: Uint8Array };

function templateFile(): string {
  return (
    process.env.SLIDE_TEMPLATE || join(process.cwd(), "template", "winlab.pptx")
  );
}

let template: Record<string, Uint8Array> | undefined;

function templateParts(): Record<string, Uint8Array> {
  template ??= unzipSync(readFileSync(templateFile()));
  return template;
}

function relationships(entries: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.join("")}</Relationships>`;
}

/**
 * The deck as .pptx bytes. `media` holds the pictures that may be embedded,
 * by sha256; a picture without bytes there is exported as an empty frame.
 */
export function exportPptx(
  document: DeckDocument,
  media: ReadonlyMap<string, Media>
): Uint8Array {
  const parts: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(templateParts())) {
    if (!name.startsWith("ppt/slides/")) parts[name] = bytes;
  }

  const mediaName = (sha256: string) => {
    const item = media.get(sha256);
    const extension = item && EXTENSIONS[item.mime];
    return extension ? `asset-${sha256.slice(0, 16)}.${extension}` : null;
  };

  const slideIds: string[] = [];
  const slideRels: string[] = [];
  const overrides: string[] = [];
  document.slides.forEach((slide, i) => {
    const n = i + 1;
    const { xml, pictures } = slideXml(slide, n, { media: mediaName });
    parts[`ppt/slides/slide${n}.xml`] = strToU8(xml);
    const rels = [
      `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="${LAYOUT}"/>`,
    ];
    for (const picture of pictures) {
      const name = mediaName(picture.sha256)!;
      parts[`ppt/media/${name}`] = media.get(picture.sha256)!.data;
      rels.push(
        `<Relationship Id="${picture.rId}" Type="${REL}/image" Target="../media/${name}"/>`
      );
    }
    parts[`ppt/slides/_rels/slide${n}.xml.rels`] = strToU8(relationships(rels));
    // Relationship ids past the template's own.
    const rId = `rId${100 + n}`;
    slideIds.push(`<p:sldId id="${255 + n}" r:id="${rId}"/>`);
    slideRels.push(
      `<Relationship Id="${rId}" Type="${REL}/slide" Target="slides/slide${n}.xml"/>`
    );
    overrides.push(
      `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="${SLIDE_TYPE}"/>`
    );
  });

  const presentation = strFromU8(parts["ppt/presentation.xml"]).replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst>`
  );
  parts["ppt/presentation.xml"] = strToU8(presentation);

  const presentationRels = strFromU8(parts["ppt/_rels/presentation.xml.rels"])
    .replace(/<Relationship [^>]*Type="[^"]*\/slide"[^>]*\/>/g, "")
    .replace("</Relationships>", `${slideRels.join("")}</Relationships>`);
  parts["ppt/_rels/presentation.xml.rels"] = strToU8(presentationRels);

  const types = strFromU8(parts["[Content_Types].xml"])
    .replace(/<Override PartName="\/ppt\/slides\/[^"]*"[^>]*\/>/g, "")
    // The template's JPEG type is not the registered one.
    .replace(
      /<Default Extension="jpeg" ContentType="[^"]*"\/>/,
      '<Default Extension="jpeg" ContentType="image/jpeg"/>'
    )
    .replace("</Types>", `${overrides.join("")}</Types>`);
  parts["[Content_Types].xml"] = strToU8(types);

  parts["docProps/core.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(document.title)}</dc:title></cp:coreProperties>`
  );

  return zipSync(parts, { level: 6 });
}
