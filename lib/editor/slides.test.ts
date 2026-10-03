import { describe, expect, it } from "vitest";

import { applyOperations } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import { guard } from "./guard";
import {
  blankSlide,
  deleteSlideOps,
  duplicateSlide,
  insertSlideOps,
  moveSlideOps,
} from "./slides";

const doc = sampleDocument();
const apply = (ops: Parameters<typeof guard>[1]) =>
  applyOperations(doc, guard(doc, ops));

describe("slide list edits", () => {
  it("adds a blank slide after the one in view, undoably", () => {
    const result = apply(insertSlideOps(1, blankSlide()));
    expect(result.document.slides).toHaveLength(2);
    expect(result.document.slides[1]).toMatchObject({ title: "", shapes: [] });
    expect(applyOperations(result.document, result.inverse).document).toEqual(
      doc
    );
  });

  it("duplicates a slide with new ids and connectors glued to the copies", () => {
    const copy = duplicateSlide(doc.slides[0]);
    expect(copy.id).not.toBe(doc.slides[0].id);
    const ids = new Set(copy.shapes.map((shape) => shape.id));
    for (const shape of doc.slides[0].shapes)
      expect(ids.has(shape.id)).toBe(false);
    for (const shape of copy.shapes) {
      if (shape.kind !== "line") continue;
      for (const end of [shape.start, shape.end]) {
        if ("shape" in end) expect(ids.has(end.shape)).toBe(true);
      }
    }
    // The schema takes it: no id is used twice.
    expect(apply(insertSlideOps(1, copy)).document.slides).toHaveLength(2);
  });

  it("moves and deletes slides", () => {
    const two = apply(
      insertSlideOps(1, { ...blankSlide(), title: "Second" })
    ).document;
    const moved = applyOperations(two, guard(two, moveSlideOps(1, 0))).document;
    expect(moved.slides.map((slide) => slide.title)).toEqual([
      "Second",
      "System overview",
    ]);
    const deleted = applyOperations(
      two,
      guard(two, deleteSlideOps(0))
    ).document;
    expect(deleted.slides.map((slide) => slide.title)).toEqual(["Second"]);
    expect(moveSlideOps(0, 0)).toEqual([]);
  });
});
