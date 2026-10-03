import { describe, expect, it } from "vitest";

import type { TextBody } from "../deck/schema";
import { measure } from "../render/metrics";
import { layoutText, type TextDefaults } from "../render/text";
import {
  caretBox,
  hitPos,
  lineEdge,
  selectionRects,
  verticalPos,
} from "./text-caret";

const defaults: TextDefaults = {
  size: 40,
  color: "#000000",
  bold: false,
  align: "left",
  anchor: "top",
  inset: { x: 10, y: 5 },
  wrap: true,
};
const style = { size: 40, bold: false, italic: false };

// "Automatic speech " fills the first line; "recognition" wraps.
const wrapped: TextBody = {
  paragraphs: [{ runs: [{ text: "Automatic speech recognition" }] }],
};
const width = measure("Automatic speech ", style) + 20;
const layout = layoutText(wrapped, { w: width, h: 500 }, defaults);

describe("text carets", () => {
  it("reports a caret stop for every offset of a line", () => {
    const [first, second] = layout.lines;
    expect(first.start).toBe(0);
    expect(first.end).toBe(17);
    expect(second.start).toBe(17);
    expect(first.carets.map((caret) => caret.at)).toEqual(
      Array.from({ length: 18 }, (_, i) => i)
    );
    expect(first.carets[0].x).toBe(10);
    expect(first.carets[9].x).toBeCloseTo(10 + measure("Automatic", style), 6);
  });

  it("puts a wrap offset on the next line unless the caret was left before it", () => {
    expect(caretBox(layout, { p: 0, o: 17 })?.line).toBe(1);
    expect(caretBox(layout, { p: 0, o: 17, before: true })?.line).toBe(0);
  });

  it("finds the position under a point, past the end of a line too", () => {
    const x = 10 + measure("Auto", style) + 1;
    expect(hitPos(layout, x, 5 + 10)).toEqual({ p: 0, o: 4 });
    const below = hitPos(layout, 9999, 5 + layout.lines[0].height + 5);
    expect(below).toEqual({ p: 0, o: 28 });
    // The end of the first line stays on it.
    expect(hitPos(layout, 9999, 5 + 10)).toEqual({ p: 0, o: 17, before: true });
  });

  it("moves a line down and up, keeping the caret's x", () => {
    const goal = caretBox(layout, { p: 0, o: 2 })!.x;
    const down = verticalPos(layout, { p: 0, o: 2 }, 1, goal);
    expect(caretBox(layout, down)?.line).toBe(1);
    expect(Math.abs(caretBox(layout, down)!.x - goal)).toBeLessThan(20);
    expect(verticalPos(layout, down, -1, goal)).toEqual({ p: 0, o: 2 });
    expect(verticalPos(layout, down, 1, goal)).toEqual({ p: 0, o: 28 });
  });

  it("goes to either end of a line", () => {
    expect(lineEdge(layout, { p: 0, o: 20 }, "start")).toEqual({ p: 0, o: 17 });
    expect(lineEdge(layout, { p: 0, o: 3 }, "end")).toEqual({
      p: 0,
      o: 17,
      before: true,
    });
  });

  it("covers a selection across lines with one rectangle each", () => {
    const rects = selectionRects(layout, { p: 0, o: 10 }, { p: 0, o: 20 });
    expect(rects).toHaveLength(2);
    expect(rects[0].x).toBeCloseTo(10 + measure("Automatic ", style), 6);
    expect(rects[1].x).toBe(10);
  });

  it("starts a selection made at a wrap on the next line", () => {
    const rects = selectionRects(layout, { p: 0, o: 17 }, { p: 0, o: 28 });
    expect(rects).toHaveLength(1);
    expect(rects[0].y).toBeCloseTo(5 + layout.lines[1].top, 6);
  });

  it("keeps offsets across forced line breaks and empty paragraphs", () => {
    const text: TextBody = {
      paragraphs: [{ runs: [{ text: "ab\ncd" }] }, { runs: [] }],
    };
    const result = layoutText(text, { w: 1000, h: 500 }, defaults);
    expect(result.lines.map((l) => [l.paragraph, l.start, l.end])).toEqual([
      [0, 0, 2],
      [0, 3, 5],
      [1, 0, 0],
    ]);
    expect(caretBox(result, { p: 0, o: 2 })?.line).toBe(0);
    expect(caretBox(result, { p: 0, o: 3 })?.line).toBe(1);
    expect(caretBox(result, { p: 1, o: 0 })?.line).toBe(2);
  });
});
