// The parts of fontkit scripts/font-metrics.ts uses; fontkit ships no types.
declare module "fontkit" {
  export interface Glyph {
    advanceWidth: number;
  }
  export interface Font {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    lineGap: number;
    characterSet: number[];
    hasGlyphForCodePoint(codePoint: number): boolean;
    glyphForCodePoint(codePoint: number): Glyph;
  }
  export function openSync(path: string): Font | { fonts: Font[] };
}
