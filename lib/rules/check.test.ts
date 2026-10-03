import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import type { Shape, Slide } from "../deck/schema";
import { checkDeck, checkSlide, contrast, type Rule } from "./check";

const slide = (shapes: Shape[], title = "Pipeline"): Slide => ({
  id: "sl_test",
  title,
  shapes,
});
const box = (
  id: string,
  x: number,
  y: number,
  text: string,
  extra: Partial<Extract<Shape, { kind: "rect" }>> = {}
): Shape => ({
  id,
  kind: "rect",
  x,
  y,
  w: 400,
  h: 120,
  fill: "#e8f1fe",
  stroke: { color: "#4f81bd", width: 3 },
  text: { paragraphs: [{ runs: [{ text }] }] },
  ...extra,
});
const rules = (s: Slide) => checkSlide(s, 0).map((v) => [v.shape, v.rule]);

describe("checkSlide", () => {
  it("passes a tidy slide", () => {
    expect(rules(slide([box("sh_a1", 100, 300, "Capture")]))).toEqual([]);
  });

  it("flags text too small or too large", () => {
    const small = box("sh_a1", 100, 300, "tiny", {
      text: { paragraphs: [{ runs: [{ text: "tiny", size: 20 }] }] },
    });
    const large = box("sh_b1", 700, 300, "huge", {
      h: 400,
      text: { paragraphs: [{ runs: [{ text: "huge", size: 140 }] }] },
    });
    expect(rules(slide([small, large]))).toEqual([
      ["sh_a1", "font-size"],
      ["sh_b1", "font-size"],
    ]);
  });

  it("flags colors outside the palette", () => {
    const odd = box("sh_a1", 100, 300, "Capture", { fill: "#123456" });
    const [violation] = checkSlide(slide([odd]), 0);
    expect(violation.rule).toBe("palette");
    expect(violation.message).toContain("#123456");
  });

  it("flags text that overflows its box, and a title too long to shrink", () => {
    const long = box("sh_a1", 100, 300, "word ".repeat(80), { h: 60 });
    const title = "A very long slide title that keeps going ".repeat(8);
    expect(rules(slide([long], title))).toEqual([
      [null, "title-overflow"],
      ["sh_a1", "text-overflow"],
    ]);
  });

  it("lets a plain text box grow instead of overflowing", () => {
    const grow: Shape = {
      id: "tx_note",
      kind: "text",
      x: 100,
      y: 300,
      w: 400,
      h: 40,
      text: { paragraphs: [{ runs: [{ text: "word ".repeat(40) }] }] },
    };
    expect(rules(slide([grow]))).toEqual([]);
  });

  it("flags text on top of other text", () => {
    const flagged = rules(
      slide([
        box("sh_a1", 100, 300, "Capture"),
        box("sh_b1", 150, 310, "Router"),
      ])
    );
    expect(flagged).toContainEqual(["sh_b1", "text-overlap"]);
  });

  it("flags a connector through text it does not connect", () => {
    const shapes: Shape[] = [
      box("sh_a1", 100, 300, "A"),
      box("sh_b1", 1400, 300, "B"),
      box("sh_c1", 750, 300, "In the way"),
      {
        id: "ln_ab",
        kind: "line",
        route: "straight",
        start: { shape: "sh_a1", site: 3 },
        end: { shape: "sh_b1", site: 1 },
        stroke: { color: "#000000", width: 2 },
      },
    ];
    expect(rules(slide(shapes))).toEqual([["ln_ab", "connector-crosses-text"]]);
  });

  it("flags low contrast against the fill", () => {
    const pale = box("sh_a1", 100, 300, "Pale", {
      fill: "#ffffff",
      text: { paragraphs: [{ runs: [{ text: "Pale", color: "#f2f2f2" }] }] },
    });
    expect(rules(slide([pale]))).toEqual([["sh_a1", "low-contrast"]]);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("flags a shape off the slide", () => {
    expect(rules(slide([box("sh_a1", 2000, 300, "Lost")]))).toEqual([
      ["sh_a1", "off-slide"],
    ]);
  });
});

describe("checkDeck", () => {
  it("numbers slides from 1 and names every rule it can report", () => {
    const violations = checkDeck(sampleDocument());
    for (const v of violations) {
      expect(v.slide).toBeGreaterThanOrEqual(1);
      expect(v.message.length).toBeGreaterThan(0);
    }
    const known: Rule[] = [
      "font-size",
      "palette",
      "text-overflow",
      "title-overflow",
      "text-overlap",
      "connector-crosses-text",
      "low-contrast",
      "off-slide",
    ];
    expect(violations.every((v) => known.includes(v.rule))).toBe(true);
  });
});
