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
const RANGES: [number, number][] = [
  [0x0020, 0x007e], // Basic Latin
  [0x00a0, 0x017f], // Latin-1 Supplement, Latin Extended-A
  [0x0370, 0x03ff], // Greek
  [0x2000, 0x206f], // General Punctuation
  [0x20a0, 0x20bf], // Currency
  [0x2100, 0x214f], // Letterlike symbols
  [0x2190, 0x21ff], // Arrows
  [0x2200, 0x22ff], // Math operators
  [0x25a0, 0x25ff], // Geometric shapes
];
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
  for (const [from, to] of RANGES) {
    for (let cp = from; cp <= to; cp++) {
      if (font.hasGlyphForCodePoint(cp)) {
        table[cp] = font.glyphForCodePoint(cp).advanceWidth;
      }
    }
  }
  widths[style] = table;
}

const out = {
  font: "Carlito (google/fonts 3dd78844, OFL)",
  ...vertical,
  widths,
};
writeFileSync(
  join(ROOT, "lib/render/carlito-metrics.json"),
  JSON.stringify(out) + "\n"
);
console.log(
  `font-metrics: ${Object.values(widths)
    .map((t) => Object.keys(t).length)
    .join(" / ")} glyphs, unitsPerEm ${vertical.unitsPerEm}`
);
