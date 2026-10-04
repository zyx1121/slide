// Server only: a deck as a .pptx file. The deck's template (template/*.pptx)
// supplies the master, its layouts and theme, untouched; its sample slides,
// if any, are replaced by the deck's, each on the "Title & Bullets" layout,
// so the title and the slide number land in the master's placeholders.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type { DeckDocument } from "../deck/schema";
import { templateOf } from "../render/template";
import { esc, slideXml } from "./slide";

/** The layout every exported slide uses: "Title & Bullets". */
const LAYOUT = "../slideLayouts/slideLayout2.xml";

const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SLIDE_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const NOTES_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
};

export type Media = { mime: string; data: Uint8Array };

const templates = new Map<string, Record<string, Uint8Array>>();

/** A template's .pptx parts, read once. */
function templateParts(file: string): Record<string, Uint8Array> {
  let parts = templates.get(file);
  if (!parts) {
    parts = unzipSync(readFileSync(join(process.cwd(), "template", file)));
    templates.set(file, parts);
  }
  return parts;
}

/**
 * A notes page for speaker notes, on the template's notes master: its slide
 * image and its body, a paragraph a line, which PowerPoint's presenter view
 * shows.
 */
function notesXml(notes: string): string {
  const paragraphs = notes
    .split(/\r?\n/)
    .map((line) => {
      const lang = /^[\x00-\x7f]*$/.test(line)
        ? 'lang="en-US" altLang="zh-TW"'
        : 'lang="zh-TW" altLang="en-US"';
      return line
        ? `<a:p><a:r><a:rPr ${lang} dirty="0"/><a:t>${esc(line)}</a:t></a:r></a:p>`
        : `<a:p><a:endParaRPr ${lang} dirty="0"/></a:p>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
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
  const base = templateParts(templateOf(document).pptx);
  for (const [name, bytes] of Object.entries(base)) {
    if (!name.startsWith("ppt/slides/") && !name.startsWith("ppt/notesSlides/"))
      parts[name] = bytes;
  }
  // Notes pages hang off the template's notes master.
  const notesMaster = "ppt/notesMasters/notesMaster1.xml" in base;

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
    if (notesMaster && slide.notes?.trim()) {
      rels.push(
        `<Relationship Id="rId${pictures.length + 2}" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`
      );
      parts[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(
        notesXml(slide.notes)
      );
      parts[`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`] = strToU8(
        relationships([
          `<Relationship Id="rId1" Type="${REL}/notesMaster" Target="../notesMasters/notesMaster1.xml"/>`,
          `<Relationship Id="rId2" Type="${REL}/slide" Target="../slides/slide${n}.xml"/>`,
        ])
      );
      overrides.push(
        `<Override PartName="/ppt/notesSlides/notesSlide${n}.xml" ContentType="${NOTES_TYPE}"/>`
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
    .replace(
      /<Override PartName="\/ppt\/(slides|notesSlides)\/[^"]*"[^>]*\/>/g,
      ""
    )
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
