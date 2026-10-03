import { describe, expect, it } from "vitest";

import { PresetGeometry } from "../deck/schema";
import { presetPath } from "./preset";

const box = { x: 100, y: 100, w: 400, h: 200 };

/** The corners of a polygon path. */
const points = (d: string) =>
  d
    .replace(/^M|Z$/g, "")
    .split("L")
    .map((p) => p.split(" ").map(Number));

describe("presetPath", () => {
  it("draws a right arrow with a half-height shaft and a head half the shorter side long", () => {
    expect(points(presetPath("rightArrow", box).fill)).toEqual([
      [100, 150],
      [400, 150],
      [400, 100],
      [500, 200],
      [400, 300],
      [400, 250],
      [100, 250],
    ]);
  });

  it("mirrors a left arrow and keeps every corner inside the box", () => {
    expect(points(presetPath("leftArrow", box).fill)[3]).toEqual([100, 200]);
    for (const geometry of PresetGeometry.options) {
      const { fill } = presetPath(geometry, box);
      if (fill.includes("A")) continue;
      for (const [x, y] of points(fill)) {
        expect(x).toBeGreaterThanOrEqual(100);
        expect(x).toBeLessThanOrEqual(500);
        expect(y).toBeGreaterThanOrEqual(100);
        expect(y).toBeLessThanOrEqual(300);
      }
    }
  });

  it("strokes a bracket open and fills it closed", () => {
    const { fill, stroke } = presetPath("rightBracket", box);
    expect(stroke).toMatch(/^M100 100A/);
    expect(stroke).not.toContain("Z");
    expect(fill).toBe(`${stroke}Z`);
  });
});
