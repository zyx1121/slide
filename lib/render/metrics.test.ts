import { describe, expect, it } from "vitest";

import { charWidth, fontOf, isWide, LINE_HEIGHT, measure } from "./metrics";

const regular = { size: 48, bold: false, italic: false };

describe("metrics", () => {
  it("uses Calibri's single line spacing", () => {
    // PowerPoint's single spacing, measured from its own PDF.
    expect(LINE_HEIGHT).toBe(1.2);
  });

  it("measures Latin with Carlito's widths and bold wider than regular", () => {
    // Carlito "n" is 1076 of 2048 units.
    expect(charWidth("n".codePointAt(0)!, regular)).toBeCloseTo(
      (1076 / 2048) * 48,
      6
    );
    expect(measure("Agent", { ...regular, bold: true })).toBeGreaterThan(
      measure("Agent", regular)
    );
  });

  it("draws CJK, full-width punctuation and kana one em wide", () => {
    for (const ch of ["語", "音", "，", "。", "あ", "カ", "한", "Ａ"]) {
      expect(isWide(ch.codePointAt(0)!)).toBe(true);
      expect(charWidth(ch.codePointAt(0)!, regular)).toBe(48);
    }
    expect(measure("語音辨識", regular)).toBe(192);
  });

  it("measures symbols with the font that draws them", () => {
    // ① is in Carlito (2720 of 2048 units), ※ only in Noto Sans TC (1 em).
    expect(fontOf(0x2460)).toBe("latin");
    expect(charWidth(0x2460, regular)).toBeCloseTo((2720 / 2048) * 48, 6);
    expect(fontOf(0x203b)).toBe("cjk");
    expect(charWidth(0x203b, regular)).toBe(48);
    // ✓ is narrower than an em in Noto Sans TC (683 of 1000).
    expect(charWidth(0x2713, regular)).toBeCloseTo(0.683 * 48, 6);
    // Neither font has ✅: one em, drawn by the emoji font. Thai: one em,
    // a box in the CJK font.
    expect(fontOf(0x2705)).toBe("emoji");
    expect(charWidth(0x2705, regular)).toBe(48);
    expect(fontOf(0x0e01)).toBe("cjk");
    expect(charWidth(0x0e01, regular)).toBe(48);
  });
});
