import { describe, expect, it } from "vitest";

import { measure } from "./metrics";
import {
  BULLET_HANG,
  layoutText,
  LEVEL_INDENT,
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
    expect(layout.lines[2].height).toBeCloseTo(40 * 1.2207, 3);
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
    expect(layout.lines[0].segments[0].x).toBe(BULLET_HANG);
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
    expect(centered.top).toBeCloseTo(5 + (290 - 40 * 1.2207) / 2, 3);
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
  });
});
