import { describe, expect, it } from "vitest";

import { measure } from "./metrics";
import {
  BULLET_HANG,
  layoutText,
  LEVEL_INDENT,
  NUMBER_HANG,
  type TextDefaults,
} from "./text";

const defaults: TextDefaults = {
  size: 40,
  color: "#000000",
  bold: false,
  align: "left",
  anchor: "top",
  inset: { x: 0, y: 0 },
  wrap: true,
};

const lineTexts = (layout: ReturnType<typeof layoutText>) =>
  layout.lines.map((line) => line.segments.map((s) => s.text).join(""));

const style = { size: 40, bold: false, italic: false };

describe("layoutText", () => {
  it("wraps Latin at spaces and lets the trailing space hang", () => {
    const text = "Automatic speech recognition";
    const width = measure("Automatic speech ", style);
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text }] }] },
      { w: width, h: 500 },
      defaults
    );
    expect(lineTexts(layout)).toEqual(["Automatic speech", "recognition"]);
  });

  it("wraps CJK between any two characters", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "語音辨識系統架構" }] }] },
      { w: 40 * 5, h: 500 },
      defaults
    );
    expect(lineTexts(layout)).toEqual(["語音辨識系", "統架構"]);
  });

  it("never starts a line with closing punctuation", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "語音辨識。完成" }] }] },
      { w: 40 * 4, h: 500 },
      defaults
    );
    // 。 cannot start the second line, so 識 moves down with it.
    expect(lineTexts(layout)).toEqual(["語音辨", "識。完成"]);
  });

  it("never ends a line with an opening bracket", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "測試「引號」" }] }] },
      { w: 40 * 3, h: 500 },
      defaults
    );
    expect(lineTexts(layout)[0]).toBe("測試");
  });

  it("breaks a word longer than the box by character", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "Supercalifragilistic" }] }] },
      { w: measure("Supercali", style), h: 500 },
      defaults
    );
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(lineTexts(layout).join("")).toBe("Supercalifragilistic");
  });

  it("keeps mixed runs on one line with their own styles and positions", () => {
    const layout = layoutText(
      {
        paragraphs: [
          { runs: [{ text: "ASR: ", bold: true }, { text: "Automatic" }] },
        ],
      },
      { w: 2000, h: 500 },
      defaults
    );
    const [bold, regular] = layout.lines[0].segments;
    expect(bold).toMatchObject({ text: "ASR: ", bold: true, x: 0 });
    expect(regular.x).toBeCloseTo(
      measure("ASR: ", { ...style, bold: true }),
      6
    );
  });

  it("splits a mixed run where the script changes, so each part has one font", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "旋轉 -8° 的便利貼", bold: true }] }] },
      { w: 2000, h: 500 },
      defaults
    );
    expect(
      layout.lines[0].segments.map((s) => [s.text, s.script, s.bold])
    ).toEqual([
      ["旋轉 ", "cjk", true],
      ["-8° ", "latin", true],
      ["的便利貼", "cjk", true],
    ]);
  });

  it("honours line breaks inside a run, and empty paragraphs keep their height", () => {
    const layout = layoutText(
      {
        paragraphs: [
          { runs: [{ text: "one\ntwo" }] },
          { runs: [] },
          { runs: [{ text: "three" }] },
        ],
      },
      { w: 2000, h: 500 },
      defaults
    );
    expect(lineTexts(layout)).toEqual(["one", "two", "", "three"]);
    expect(layout.lines[2].height).toBeCloseTo(40 * 1.2, 3);
  });

  it("indents bullets by level and numbers them per level", () => {
    const layout = layoutText(
      {
        paragraphs: [
          { bullet: "number", runs: [{ text: "First" }] },
          { bullet: "number", runs: [{ text: "Second" }] },
          { bullet: "bullet", level: 1, runs: [{ text: "Detail" }] },
          { bullet: "number", runs: [{ text: "Third" }] },
        ],
      },
      { w: 2000, h: 500 },
      defaults
    );
    expect(layout.lines.map((l) => l.bullet?.text)).toEqual([
      "1.",
      "2.",
      "•",
      "3.",
    ]);
    expect(layout.lines[0].segments[0].x).toBe(NUMBER_HANG);
    expect(layout.lines[2].segments[0].x).toBe(LEVEL_INDENT + BULLET_HANG);
    expect(layout.lines[2].bullet?.x).toBe(LEVEL_INDENT);
  });

  it("aligns and anchors inside the insets", () => {
    const width = measure("Hi", style);
    const centered = layoutText(
      { paragraphs: [{ align: "center", runs: [{ text: "Hi" }] }] },
      { w: 400, h: 300 },
      { ...defaults, anchor: "middle", inset: { x: 10, y: 5 } }
    );
    expect(centered.lines[0].segments[0].x).toBeCloseTo(
      10 + (380 - width) / 2,
      6
    );
    expect(centered.top).toBeCloseTo(5 + (290 - 40 * 1.2) / 2, 3);
    const right = layoutText(
      { paragraphs: [{ align: "right", runs: [{ text: "Hi" }] }] },
      { w: 400, h: 300 },
      defaults
    );
    expect(right.lines[0].segments[0].x).toBeCloseTo(400 - width, 6);
  });

  it("keeps a paragraph on one line when wrapping is off", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "a b c d e f g" }] }] },
      { w: 10, h: 100 },
      { ...defaults, wrap: false }
    );
    expect(layout.lines).toHaveLength(1);
    // A body can turn wrapping off for itself, as an imported wrap="none".
    const unwrapped = layoutText(
      { paragraphs: [{ runs: [{ text: "a b c d e f g" }] }], wrap: false },
      { w: 10, h: 100 },
      defaults
    );
    expect(unwrapped.lines).toHaveLength(1);
  });

  it("does not break a Latin word in the middle", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "Automatic speech recognition" }] }] },
      { w: measure("Automatic speech re", style), h: 500 },
      defaults
    );
    expect(lineTexts(layout)).toEqual(["Automatic speech", "recognition"]);
  });

  it("lets spaces at a break hang, so the next line starts with the word", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "aaa    bbb" }] }] },
      { w: measure("aaa ", style), h: 500 },
      defaults
    );
    expect(lineTexts(layout)).toEqual(["aaa", "bbb"]);
    expect(layout.lines[1].segments[0].x).toBe(0);
  });

  it("breaks after a hyphen inside a word", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "end-to-end pipeline" }] }] },
      { w: measure("end-to-en", style), h: 500 },
      defaults
    );
    // Room for "end-to-en", but the break comes after the hyphen.
    expect(lineTexts(layout)[0]).toBe("end-to-");
    expect(lineTexts(layout)[1].startsWith("end")).toBe(true);
  });

  it("keeps a full-width comma off the start of a line", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "語音，辨識" }] }] },
      { w: 40 * 2, h: 500 },
      defaults
    );
    expect(lineTexts(layout)).toEqual(["語", "音，", "辨識"]);
  });

  it("restarts numbering after a paragraph without a number", () => {
    const layout = layoutText(
      {
        paragraphs: [
          { bullet: "number", runs: [{ text: "a" }] },
          { bullet: "number", runs: [{ text: "b" }] },
          { runs: [{ text: "break" }] },
          { bullet: "number", runs: [{ text: "c" }] },
        ],
      },
      { w: 2000, h: 500 },
      defaults
    );
    expect(layout.lines.map((l) => l.bullet?.text)).toEqual([
      "1.",
      "2.",
      undefined,
      "1.",
    ]);
  });

  it("labels no empty paragraph and numbers on past it, as PowerPoint does", () => {
    const layout = layoutText(
      {
        paragraphs: [
          { bullet: "number", runs: [{ text: "one" }] },
          { bullet: "number", runs: [{ text: "" }] },
          { bullet: "number", runs: [{ text: "two" }] },
          { bullet: "bullet", runs: [] },
          { bullet: "bullet", runs: [{ text: "dot" }] },
        ],
      },
      { w: 2000, h: 500 },
      defaults
    );
    expect(layout.lines.map((l) => l.bullet?.text)).toEqual([
      "1.",
      undefined,
      "2.",
      undefined,
      "•",
    ]);
    // A bullet may be another character.
    const dashed = layoutText(
      {
        paragraphs: [
          { bullet: "bullet", bulletChar: "–", runs: [{ text: "a" }] },
        ],
      },
      { w: 2000, h: 500 },
      defaults
    );
    expect(dashed.lines[0].bullet?.text).toBe("–");
  });

  it("spaces lines and paragraphs as PowerPoint does", () => {
    const layout = layoutText(
      {
        paragraphs: [
          { runs: [{ text: "one" }], spaceBefore: 30 },
          { runs: [{ text: "two" }], lineSpacing: 2, spaceAfter: 20 },
          { runs: [{ text: "three" }] },
        ],
      },
      { w: 2000, h: 1000 },
      defaults
    );
    const [one, two, three] = layout.lines;
    // No space before the first paragraph; 2x lines are 2.4 em tall, the
    // baseline 0.875 em lower than single; then 20 px after.
    expect(one.top).toBe(0);
    expect(two.top).toBeCloseTo(40 * 1.2, 6);
    expect(two.height).toBeCloseTo(40 * 2.4, 6);
    expect(two.baseline - two.top).toBeCloseTo(
      one.baseline - one.top + 40 * 0.875,
      6
    );
    expect(three.top).toBeCloseTo(40 * 1.2 + 40 * 2.4 + 20, 6);
  });

  it("pushes the first line past a number wider than its hanging indent", () => {
    const size = 120;
    const layout = layoutText(
      {
        paragraphs: [
          {
            bullet: "number",
            runs: [{ text: "Long numbered item that wraps", size }],
          },
        ],
      },
      { w: 900, h: 2000 },
      defaults
    );
    const [first, second] = layout.lines;
    const labelEnd =
      first.bullet!.x + measure("1.", { size, bold: false, italic: false });
    expect(first.segments[0].x).toBeGreaterThan(labelEnd);
    expect(second.segments[0].x).toBe(NUMBER_HANG);
  });

  it("treats vertical tabs as line breaks and drops other control characters", () => {
    const layout = layoutText(
      {
        paragraphs: [
          {
            runs: [
              { text: "line\u0001 one\u000bline two\u0007\u2028line three" },
            ],
          },
        ],
      },
      { w: 2000, h: 500 },
      defaults
    );
    expect(lineTexts(layout)).toEqual(["line one", "line two", "line three"]);
  });

  it("draws curly quotes one em wide in Chinese runs only, as PowerPoint does", () => {
    const scripts = (text: string) =>
      layoutText(
        { paragraphs: [{ runs: [{ text }] }] },
        { w: 2000, h: 500 },
        defaults
      ).lines[0].segments.map((s) => [s.text, s.script, s.width]);
    // English: Carlito's quotes, as wide as they are there.
    expect(scripts("the user’s “hi”").map(([, script]) => script)).toEqual([
      "latin",
    ]);
    // Chinese: the CJK font's, one em each.
    expect(scripts("他說“你好”")).toEqual([["他說“你好”", "cjk", 40 * 6]]);
    // Mixed in one run: Chinese, so the quotes around English are wide too.
    expect(
      scripts("中文“English”").map(([text, script]) => [text, script])
    ).toEqual([
      ["中文“", "cjk"],
      ["English", "latin"],
      ["”", "cjk"],
    ]);
    // Quotes never open a break inside a word.
    const narrow = layoutText(
      { paragraphs: [{ runs: [{ text: "don’t stop" }] }] },
      { w: measure("don’t s", style), h: 500 },
      defaults
    );
    expect(lineTexts(narrow)).toEqual(["don’t", "stop"]);
  });

  it("splits symbols by the font that draws them", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "①※★✅" }] }] },
      { w: 2000, h: 500 },
      defaults
    );
    expect(layout.lines[0].segments.map((s) => [s.text, s.script])).toEqual([
      ["①", "latin"],
      ["※★", "cjk"],
      ["✅", "emoji"],
    ]);
  });

  it("justifies lines but the last, spreading space between words", () => {
    const text = "aaaa bbbb cccc dddd eeee ffff";
    const width = measure("aaaa bbbb cccc ", style);
    const layout = layoutText(
      { paragraphs: [{ align: "justify", runs: [{ text }] }] },
      { w: width + 30, h: 500 },
      defaults
    );
    const [first, last] = layout.lines;
    // The first line ends at the right edge: its words moved apart.
    const end = first.segments.at(-1)!;
    expect(end.x + end.width).toBeCloseTo(width + 30, 3);
    expect(first.segments.map((s) => s.text.trim()).filter(Boolean)).toEqual([
      "aaaa",
      "bbbb",
      "cccc",
    ]);
    // The last line keeps its natural spacing, from the left.
    expect(last.segments[0].x).toBe(0);
    expect(last.segments.length).toBe(1);
    // Carets follow the moved words.
    const c = first.carets.find((caret) => caret.at === 10)!;
    expect(c.x).toBeCloseTo(
      first.segments.find((s) => s.text.startsWith("cccc"))!.x,
      3
    );
  });

  it("justifies CJK between characters", () => {
    const layout = layoutText(
      {
        paragraphs: [
          { align: "justify", runs: [{ text: "語音辨識系統架構與設計" }] },
        ],
      },
      { w: 40 * 4.5, h: 500 },
      defaults
    );
    const [first] = layout.lines;
    expect(first.segments.map((s) => s.text)).toEqual(["語", "音", "辨", "識"]);
    const end = first.segments.at(-1)!;
    expect(end.x + end.width).toBeCloseTo(40 * 4.5, 3);
  });

  it("lays out a very long line without running out of stack", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "a".repeat(200_000) }] }] },
      { w: 400, h: 500 },
      defaults
    );
    expect(layout.lines.length).toBeGreaterThan(100);
  });

  it("never breaks at a no-break space", () => {
    const layout = layoutText(
      { paragraphs: [{ runs: [{ text: "aaaa bbbb\u00a0cccc" }] }] },
      { w: measure("aaaa bbbb", style), h: 500 },
      defaults
    );
    expect(lineTexts(layout)).toEqual(["aaaa", "bbbb\u00a0cccc"]);
  });
});
