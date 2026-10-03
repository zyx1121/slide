// Generates lib/render/carlito-metrics.json: the advance widths of Carlito,
// which has Calibri's metrics, for the characters slide text uses. The text
// layout (lib/render/text.ts) measures with it, so the browser and the server
// wrap lines the same way without loading font files to measure.
//
//   sh scripts/fetch-fonts.sh && bun scripts/font-metrics.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import * as fontkit from "fontkit";

const ROOT = join(import.meta.dirname, "..");
// Every character Carlito draws except Cyrillic, which WinLab slides do not
// use: Latin, Greek, punctuation, symbols, arrows, circled numbers.
const isCyrillic = (cp: number) => cp >= 0x0400 && cp <= 0x052f;
const STYLES = {
  regular: "Carlito-Regular.ttf",
  bold: "Carlito-Bold.ttf",
  italic: "Carlito-Italic.ttf",
  boldItalic: "Carlito-BoldItalic.ttf",
} as const;

const widths: Record<string, Record<string, number>> = {};
let vertical = { unitsPerEm: 0, ascender: 0, descender: 0, lineGap: 0 };
for (const [style, file] of Object.entries(STYLES)) {
  const font = fontkit.openSync(
    join(ROOT, "fonts/slide", file)
  ) as fontkit.Font;
  vertical = {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascent,
    descender: font.descent,
    lineGap: font.lineGap,
  };
  const table: Record<string, number> = {};
  for (const cp of [...font.characterSet].sort((a, b) => a - b)) {
    if (cp >= 0x20 && !isCyrillic(cp)) {
      table[cp] = font.glyphForCodePoint(cp).advanceWidth;
    }
  }
  widths[style] = table;
}

// Symbols Carlito lacks (circled numbers, ※, ★, ✓, CJK punctuation forms)
// are drawn by Noto Sans TC; record their widths too, so they are measured
// with the font that draws them.
const NOTO_RANGES: [number, number][] = [
  [0x00a0, 0x02ff],
  [0x2000, 0x2bff],
  [0x3000, 0x303f],
  [0xfe30, 0xfe6f],
  [0xff00, 0xffef],
];
const regular = fontkit.openSync(
  join(ROOT, "fonts/slide", STYLES.regular)
) as fontkit.Font;
const noto = fontkit.openSync(
  join(ROOT, "fonts/slide/NotoSansTC-Regular.otf")
) as fontkit.Font;
const notoWidths: Record<string, number> = {};
for (const [from, to] of NOTO_RANGES) {
  for (let cp = from; cp <= to; cp++) {
    if (!regular.hasGlyphForCodePoint(cp) && noto.hasGlyphForCodePoint(cp)) {
      notoWidths[cp] = noto.glyphForCodePoint(cp).advanceWidth;
    }
  }
}

const out = {
  font: "Carlito (google/fonts 3dd78844, OFL)",
  ...vertical,
  widths,
  noto: {
    font: "Noto Sans TC (notofonts Sans2.004, OFL)",
    unitsPerEm: noto.unitsPerEm,
    widths: notoWidths,
  },
};
writeFileSync(
  join(ROOT, "lib/render/carlito-metrics.json"),
  JSON.stringify(out) + "\n"
);
console.log(
  `font-metrics: ${Object.keys(widths.regular).length} Carlito glyphs per style, ${Object.keys(notoWidths).length} Noto Sans TC symbols`
);
