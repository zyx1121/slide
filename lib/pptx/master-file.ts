// A deck's master file: the .pptx it came from cut down to its slide masters,
// so the masters, layouts, themes and their pictures go back out on export
// unchanged. Only what the masters need is kept, by a list: slides, notes,
// comments, charts and their workbooks, document properties and anything
// else a file carries never reach a published deck's download. Its sha256
// names it in the deck (document.master.file).
import { createHash } from "node:crypto";

import { strFromU8, strToU8, zipSync } from "fflate";

import { relationships } from "./read";

const PRESENTATION = "ppt/presentation.xml";
const SLIDE_PART = /^ppt\/(slides|notesSlides|comments)\//;
const PRESENTATION_RELS = "ppt/_rels/presentation.xml.rels";

/** What the presentation keeps pointing at: the masters and their settings. */
const KEPT_TYPES = new Set([
  "slideMaster",
  "notesMaster",
  "handoutMaster",
  "theme",
  "presProps",
  "viewProps",
  "tableStyles",
]);

/** A relationship's type, its last segment. */
const typeOf = (type: string) => type.slice(type.lastIndexOf("/") + 1);

/** A .rels file's part: ppt/_rels/presentation.xml.rels is ppt/presentation.xml's. */
const relsOf = (part: string) => {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
};

const EMPTY_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title></dc:title></cp:coreProperties>`;

/**
 * The master file of a .pptx's parts (all of them, as unzipMasterParts
 * reads them). Zipped with fixed dates, so the same parts always give the
 * same bytes.
 */
export function masterFile(parts: Map<string, Uint8Array>): {
  bytes: Uint8Array;
  sha256: string;
} {
  const kept = new Map<string, Uint8Array>();
  const presentationRels = relationships(parts, PRESENTATION);

  // The presentation keeps its masters and settings, nothing else.
  const keptIds = new Set(
    [...presentationRels]
      .filter(([, rel]) => !rel.external && KEPT_TYPES.has(typeOf(rel.type)))
      .map(([id]) => id)
  );
  const relsXml = strFromU8(parts.get(PRESENTATION_RELS) ?? new Uint8Array());
  kept.set(
    PRESENTATION_RELS,
    strToU8(
      relsXml.replace(/<Relationship\b[^>]*\/>/g, (rel) => {
        const id = /\bId="([^"]*)"/.exec(rel)?.[1];
        return id && keptIds.has(id) ? rel : "";
      })
    )
  );
  kept.set(
    PRESENTATION,
    strToU8(
      strFromU8(parts.get(PRESENTATION) ?? new Uint8Array())
        // Lists that name slides, sections, fonts or other parts left out.
        .replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/, "")
        .replace(/<p:custShowLst>[\s\S]*?<\/p:custShowLst>/, "")
        .replace(/<p:embeddedFontLst>[\s\S]*?<\/p:embeddedFontLst>/, "")
        .replace(/<p:custDataLst>[\s\S]*?<\/p:custDataLst>/, "")
        .replace(/<p:extLst>[\s\S]*?<\/p:extLst>/, "")
    )
  );

  // Everything the kept parts point at, and what that points at.
  const queue = [...presentationRels]
    .filter(([id]) => keptIds.has(id))
    .map(([, rel]) => rel.target);
  while (queue.length > 0) {
    const part = queue.shift()!;
    // A master's link to a slide does not bring the slide along.
    if (kept.has(part) || !parts.has(part) || SLIDE_PART.test(part)) continue;
    kept.set(part, parts.get(part)!);
    const rels = relsOf(part);
    if (parts.has(rels)) kept.set(rels, parts.get(rels)!);
    for (const rel of relationships(parts, part).values()) {
      if (!rel.external) queue.push(rel.target);
    }
  }

  // The package's own: the presentation, and empty document properties
  // an export fills in.
  kept.set(
    "_rels/.rels",
    strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`)
  );
  kept.set("docProps/core.xml", strToU8(EMPTY_CORE));
  const types = strFromU8(parts.get("[Content_Types].xml") ?? new Uint8Array())
    .replace(/<Override\b[^>]*\/>/g, (override) => {
      const name = /\bPartName="\/([^"]*)"/.exec(override)?.[1];
      return name && kept.has(name) ? override : "";
    })
    .replace(
      "</Types>",
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'
    );
  kept.set("[Content_Types].xml", strToU8(types));

  const files: Record<string, [Uint8Array, { mtime: Date }]> = {};
  const mtime = new Date("1980-01-01T00:00:00Z");
  for (const [name, bytes] of [...kept].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    files[name] = [bytes, { mtime }];
  }
  const bytes = zipSync(files, { level: 6 });
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
