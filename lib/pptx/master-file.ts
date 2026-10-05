// A deck's master file: the .pptx it came from without its slides, so that
// the slide masters, layouts, themes and their pictures go back out on
// export unchanged. Its sha256 names it in the deck (document.master.file).
import { createHash } from "node:crypto";

import { strFromU8, strToU8, zipSync } from "fflate";

import { relationships } from "./read";

/** Where a slide-only part lives: slides, their notes and the thumbnail. */
const SLIDE_PART = /^(ppt\/(slides|notesSlides)\/|docProps\/thumbnail\.)/;

/** The parts a .rels file belongs to: ppt/_rels/presentation.xml.rels is ppt/presentation.xml's. */
const sourceOf = (relsName: string) =>
  relsName.replace(/(^|\/)_rels\/([^/]+)\.rels$/, "$1$2");

/**
 * The master file of a .pptx's parts: everything but the slides, their notes
 * and the pictures only they used; the presentation keeps no slide list.
 * Zipped with fixed dates, so the same parts always give the same bytes.
 */
export function masterFile(parts: Map<string, Uint8Array>): {
  bytes: Uint8Array;
  sha256: string;
} {
  const kept = new Map([...parts].filter(([name]) => !SLIDE_PART.test(name)));
  const presentation = kept.get("ppt/presentation.xml");
  if (presentation) {
    kept.set(
      "ppt/presentation.xml",
      strToU8(
        strFromU8(presentation).replace(
          /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/,
          ""
        )
      )
    );
  }
  const presentationRels = kept.get("ppt/_rels/presentation.xml.rels");
  if (presentationRels) {
    kept.set(
      "ppt/_rels/presentation.xml.rels",
      strToU8(
        strFromU8(presentationRels).replace(
          /<Relationship [^>]*Type="[^"]*\/slide"[^>]*\/>/g,
          ""
        )
      )
    );
  }
  const types = kept.get("[Content_Types].xml");
  if (types) {
    kept.set(
      "[Content_Types].xml",
      strToU8(
        strFromU8(types).replace(
          /<Override PartName="\/(ppt\/(slides|notesSlides)\/|docProps\/thumbnail)[^"]*"[^>]*\/>/g,
          ""
        )
      )
    );
  }
  // Pictures and other media no remaining part points at go too.
  const used = new Set<string>();
  for (const name of kept.keys()) {
    if (!name.endsWith(".rels")) continue;
    for (const rel of relationships(kept, sourceOf(name)).values()) {
      if (!rel.external) used.add(rel.target);
    }
  }
  const files: Record<string, [Uint8Array, { mtime: Date }]> = {};
  const mtime = new Date("1980-01-01T00:00:00Z");
  for (const [name, bytes] of [...kept].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    if (name.startsWith("ppt/media/") && !used.has(name)) continue;
    files[name] = [bytes, { mtime }];
  }
  const bytes = zipSync(files, { level: 6 });
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
