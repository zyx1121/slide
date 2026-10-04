import { describe, expect, it } from "vitest";

import { applyOperations } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import {
  addShapes,
  addSlide,
  deleteShapes,
  deleteSlide,
  moveSlide,
  setSlideTitle,
  updateShapes,
  WriteError,
} from "./write";

const doc = sampleDocument();
const apply = (ops: unknown) => applyOperations(doc, ops).document;

describe("agent writes by id", () => {
  it("adds shapes with fresh ids, gluing connectors to the ids it gave", () => {
    const plan = addShapes(doc, 1, [
      { id: "box", kind: "rect", x: 10, y: 10, w: 100, h: 50 },
      {
        kind: "line",
        route: "straight",
        start: { shape: "box", site: 3 },
        end: { shape: "sh_capture", site: 1 },
        stroke: { color: "#000000", width: 2 },
      },
    ]);
    expect(plan.created).toHaveLength(2);
    const shapes = apply(plan.ops).slides[0].shapes;
    const box = shapes.find((shape) => shape.id === plan.created[0])!;
    const line = shapes.find((shape) => shape.id === plan.created[1])!;
    // "box" is not an id the schema takes: the box got one of its own.
    expect(box.id).toMatch(/^sh_/);
    expect(line).toMatchObject({ start: { shape: box.id } });
  });

  it("never reuses an id the deck has", () => {
    const plan = addShapes(doc, 1, [
      { id: "sh_capture", kind: "rect", x: 0, y: 0, w: 10, h: 10 },
      { id: "sh_mine", kind: "rect", x: 0, y: 0, w: 10, h: 10 },
    ]);
    expect(plan.created[0]).not.toBe("sh_capture");
    expect(plan.created[1]).toBe("sh_mine");
  });

  it("updates fields by id and keeps ids and kinds fixed", () => {
    const plan = updateShapes(doc, "sl_overview", [
      { id: "sh_asr", set: { fill: "#fff2cc", x: 1300 } },
    ]);
    const shape = apply(plan.ops).slides[0].shapes.find(
      (s) => s.id === "sh_asr"
    );
    expect(shape).toMatchObject({ fill: "#fff2cc", x: 1300 });
    expect(plan.changed).toEqual(["sh_asr"]);
    expect(() =>
      updateShapes(doc, 1, [{ id: "sh_asr", set: { kind: "ellipse" } }])
    ).toThrow(WriteError);
    expect(() =>
      updateShapes(doc, 1, [{ id: "sh_nothere", set: { x: 1 } }])
    ).toThrow(WriteError);
  });

  it("deletes shapes and reports the connectors it unglued", () => {
    const plan = deleteShapes(doc, 1, ["sh_asr"]);
    const after = apply(plan.ops).slides[0];
    expect(after.shapes.some((s) => s.id === "sh_asr")).toBe(false);
    expect(plan.changed.length).toBeGreaterThan(0);
  });

  it("adds, moves and deletes slides", () => {
    const added = addSlide(doc, { after: 0, title: "First" });
    const withSlide = applyOperations(doc, added.ops).document;
    expect(withSlide.slides[0].title).toBe("First");
    const moved = moveSlide(withSlide, 1, 2);
    expect(applyOperations(withSlide, moved.ops).document.slides[1].title).toBe(
      "First"
    );
    expect(() => deleteSlide(doc, 1)).toThrow("at least one slide");
    expect(() => moveSlide(doc, 1, 1)).toThrow(WriteError);
  });

  it("sets and clears a slide's title, by number or id", () => {
    const titled = apply(setSlideTitle(doc, 1, "  Overview\nand plan ").ops);
    expect(titled.slides[0].title).toBe("Overview\nand plan");
    const plan = setSlideTitle(titled, "sl_overview", "");
    expect(plan.changed).toEqual(["sl_overview"]);
    expect(applyOperations(titled, plan.ops).document.slides[0].title).toBe("");
    expect(() => setSlideTitle(titled, 1, "Overview\nand plan")).toThrow(
      "has that title"
    );
    expect(() => setSlideTitle(doc, 2, "None")).toThrow("no slide 2");
  });

  it("refuses when the shapes have moved since the plan was made", () => {
    const plan = updateShapes(doc, 1, [{ id: "sh_asr", set: { x: 5 } }]);
    // Another edit swaps the first two shapes: the id test no longer holds.
    const swapped = applyOperations(doc, [
      { op: "move", from: "/slides/0/shapes/1", path: "/slides/0/shapes/0" },
    ]).document;
    expect(() => applyOperations(swapped, plan.ops)).toThrow();
  });
});
