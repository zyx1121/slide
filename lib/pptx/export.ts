// Server only: a deck as a .pptx file. The deck's master file supplies the
// masters, layouts and themes, untouched; the deck's slides are added, each
// on its layout, so the title and the slide number land in its placeholders.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type { DeckDocument } from "../deck/schema";
import { builtinMasterFile } from "../master/builtin-assets";
import { layoutOf } from "../master/layout";
import { child, children, parseXml, relationships as relsOf } from "./read";
import { esc, slideXml } from "./slide";

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

/** The layout parts of a master in the file, in the master's order. */
function layoutParts(parts: Map<string, Uint8Array>, master: string): string[] {
  const xml = parts.get(master);
  if (!xml) throw new Error(`the master file has no ${master}`);
  const rels = relsOf(parts, master);
  return children(child(parseXml(xml), "p:sldLayoutIdLst"), "p:sldLayoutId")
    .map((id) => rels.get(id.attrs["r:id"] ?? "")?.target)
    .filter((name): name is string => !!name && parts.has(name));
}

/**
 * A notes page for speaker notes, on the master file's notes master: its slide
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
 * The deck as .pptx bytes, on its master file (`masterFile`, the bytes
 * document.master.file names; a built-in master's when left out). `media`
 * holds the pictures that may be embedded, by sha256; a picture without
 * bytes there is exported as an empty frame.
 */
export function exportPptx(
  document: DeckDocument,
  media: ReadonlyMap<string, Media>,
  masterFile = builtinMasterFile(document.master.file)
): Uint8Array {
  if (!masterFile) {
    throw new Error(`no master file ${document.master.file}`);
  }
  const parts: Record<string, Uint8Array> = {};
  const base = unzipSync(masterFile);
  const layouts = layoutParts(
    new Map(Object.entries(base)),
    document.master.part
  );
  if (layouts.length === 0) {
    throw new Error(`${document.master.part} has no layouts in its file`);
  }
  // Slides take relationship ids past the presentation's own.
  const firstId =
    Math.max(
      0,
      ...[
        ...strFromU8(base["ppt/_rels/presentation.xml.rels"]).matchAll(
          /\bId="rId(\d+)"/g
        ),
      ].map((match) => Number(match[1]))
    ) + 1;
  for (const [name, bytes] of Object.entries(base)) {
    if (!name.startsWith("ppt/slides/") && !name.startsWith("ppt/notesSlides/"))
      parts[name] = bytes;
  }
  // Notes pages hang off the master file's notes master.
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
    const layout = layoutOf(document, slide);
    const { xml, pictures } = slideXml(slide, n, { media: mediaName, layout });
    parts[`ppt/slides/slide${n}.xml`] = strToU8(xml);
    const at = slide.layout ?? document.master.layout;
    const layoutPart = layouts[at] ?? layouts[0];
    const rels = [
      `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../${layoutPart.replace(/^ppt\//, "")}"/>`,
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
    const rId = `rId${firstId + i}`;
    slideIds.push(`<p:sldId id="${255 + n}" r:id="${rId}"/>`);
    slideRels.push(
      `<Relationship Id="${rId}" Type="${REL}/slide" Target="slides/slide${n}.xml"/>`
    );
    overrides.push(
      `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="${SLIDE_TYPE}"/>`
    );
  });

  // The master file keeps no slide list; the schema puts it after the
  // master lists, before the slide size.
  const list = `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst>`;
  const xml = strFromU8(parts["ppt/presentation.xml"]).replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/,
    ""
  );
  const after = [
    "</p:handoutMasterIdLst>",
    "</p:notesMasterIdLst>",
    "</p:sldMasterIdLst>",
  ].find((tag) => xml.includes(tag));
  if (!after) throw new Error("the master file's presentation lists no master");
  const presentation = xml.replace(after, `${after}${list}`);
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
    // The WinLab file's JPEG type is not the registered one.
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
