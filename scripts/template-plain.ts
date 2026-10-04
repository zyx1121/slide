// Regenerates template/plain.pptx from template/winlab.pptx: the same master
// placeholders, text styles and theme fonts, so the renderer's geometry holds
// for both, with the WinLab artwork taken out. Kept: the master and its
// "Title & Bullets" layout. Gone: the other layouts, the sample slides, every
// picture and drawn shape of the master, its gradient background, the
// WinLab blue of the title and bullets, and the white of the slide number.
//
//   bun scripts/template-plain.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const root = join(import.meta.dirname, "..");
const parts = unzipSync(readFileSync(join(root, "template", "winlab.pptx")));
const text = (name: string) => strFromU8(parts[name]);
const write = (name: string, xml: string) => {
  parts[name] = strToU8(xml);
};

/** Replaces `from` with `to` in a part, failing when it is not there. */
function swap(name: string, from: string | RegExp, to: string) {
  const before = text(name);
  const after = before.replace(from, to);
  if (after === before) throw new Error(`${name}: ${String(from)} not found`);
  write(name, after);
}

/** The end of the element that opens at `start`, counting nested ones. */
function elementEnd(xml: string, start: number): number {
  const opening = xml.slice(start, xml.indexOf(">", start) + 1);
  if (opening.endsWith("/>")) return start + opening.length;
  const tag = /^<([\w:]+)/.exec(opening)![1];
  const pattern = new RegExp(`<${tag}[\\s>/]|</${tag}>`, "g");
  pattern.lastIndex = start;
  let depth = 0;
  for (let match; (match = pattern.exec(xml));) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return match.index + match[0].length;
  }
  throw new Error(`no end for <${tag}>`);
}

/** The master's shape tree with only its placeholders left. */
function placeholdersOnly(xml: string): string {
  const open = xml.indexOf("<p:spTree>");
  const close = xml.indexOf("</p:spTree>");
  const tree = xml.slice(open + "<p:spTree>".length, close);
  const kept: string[] = [];
  let at = 0;
  while (at < tree.length) {
    const start = tree.indexOf("<", at);
    if (start < 0) break;
    const end = elementEnd(tree, start);
    const element = tree.slice(start, end);
    const shape = /^<p:(sp|pic|grpSp|cxnSp|graphicFrame)[\s>]/.test(element);
    if (!shape || element.includes("<p:ph ")) kept.push(element);
    at = end;
  }
  return xml.slice(0, open) + `<p:spTree>${kept.join("")}` + xml.slice(close);
}

// Only layout 2, "Title & Bullets", which every exported slide uses.
const DROPPED_LAYOUTS = [1, 3, 4, 5];
for (const name of Object.keys(parts)) {
  const layout = /^ppt\/slideLayouts\/(?:_rels\/)?slideLayout(\d+)\.xml/.exec(
    name
  );
  if (
    name.startsWith("ppt/slides/") ||
    name.startsWith("ppt/media/") ||
    (layout && DROPPED_LAYOUTS.includes(Number(layout[1])))
  ) {
    delete parts[name];
  }
}

const MASTER = "ppt/slideMasters/slideMaster1.xml";
const MASTER_RELS = "ppt/slideMasters/_rels/slideMaster1.xml.rels";
write(MASTER, placeholdersOnly(text(MASTER)));
swap(
  MASTER,
  /<p:bg>[\s\S]*?<\/p:bg>/,
  '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
);
// The title and the body's bullets in black.
swap(MASTER, /3297FC/g, "000000");
// The slide number in regular gray, no longer white on the footer bar.
swap(
  MASTER,
  '<a:defRPr b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr>',
  '<a:defRPr b="0"><a:solidFill><a:srgbClr val="7F7F7F"/></a:solidFill></a:defRPr>'
);
// The layout list keeps layout 2 (rId4); the picture's relationship goes too.
swap(
  MASTER,
  /<p:sldLayoutIdLst>[\s\S]*?<\/p:sldLayoutIdLst>/,
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483650" r:id="rId4"/></p:sldLayoutIdLst>'
);
write(
  MASTER_RELS,
  text(MASTER_RELS).replace(/<Relationship Id="rId(2|3|5|6|7)"[^>]*\/>/g, "")
);
if (/r:(embed|link)=/.test(text(MASTER))) {
  throw new Error("the master still points at a picture");
}

// No sample slides: an export adds the deck's own.
swap(
  "ppt/presentation.xml",
  /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
  "<p:sldIdLst></p:sldIdLst>"
);
write(
  "ppt/_rels/presentation.xml.rels",
  text("ppt/_rels/presentation.xml.rels").replace(
    /<Relationship [^>]*Type="[^"]*\/slide"[^>]*\/>/g,
    ""
  )
);
write(
  "[Content_Types].xml",
  text("[Content_Types].xml").replace(
    new RegExp(
      `<Override PartName="/ppt/(slides/[^"]*|slideLayouts/slideLayout(${DROPPED_LAYOUTS.join("|")})\\.xml)"[^>]*/>`,
      "g"
    ),
    ""
  )
);
for (const theme of ["ppt/theme/theme1.xml", "ppt/theme/theme2.xml"]) {
  write(theme, text(theme).replaceAll("WinLAB Template", "Plain"));
}

const out = join(root, "template", "plain.pptx");
writeFileSync(out, zipSync(parts, { level: 9, mtime: new Date(2026, 9, 4) }));
console.log(`template-plain: ${out}`);
