import { describe, expect, it } from "vitest";

import { applyOperations } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import type { Shape } from "../deck/schema";
import { boxOps, deleteOps, insertOps, moveOps, reorderOps } from "./ops";
import { movedSlide, newShape, resizedSlide } from "./preview";

const doc = sampleDocument();
const slide = doc.slides[0];
const apply = (ops: unknown) => applyOperations(doc, ops).document.slides[0];
const ids = (shapes: Shape[]) => shapes.map((shape) => shape.id);
const find = (shapes: Shape[], id: string) =>
  shapes.find((shape) => shape.id === id)!;

describe("moveOps", () => {
  it("moves boxes and free connector ends, never glued ends", () => {
    const withFree = {
      ...doc,
      slides: [
        {
          ...slide,
          shapes: [
            ...slide.shapes,
            {
              id: "ln_free",
              kind: "line",
              route: "straight",
              start: { x: 10, y: 20 },
              end: { shape: "sh_asr", site: 0 },
              stroke: { color: "#000000", width: 2 },
            } as Shape,
          ],
        },
      ],
    };
    const picked = new Set(["sh_capture", "ln_capture_asr", "ln_free"]);
    const ops = moveOps(withFree.slides[0], 0, picked, 10.123, -5);
    const after = applyOperations(withFree, ops).document.slides[0].shapes;
    expect(find(after, "sh_capture")).toMatchObject({ x: 170.12, y: 315 });
    expect(find(after, "ln_capture_asr")).toEqual(
      find(slide.shapes, "ln_capture_asr")
    );
    expect(find(after, "ln_free")).toMatchObject({
      start: { x: 20.12, y: 15 },
      end: { shape: "sh_asr", site: 0 },
    });
  });
});

describe("boxOps", () => {
  it("writes only the fields that change", () => {
    const ops = boxOps(slide, 0, "sh_asr", { x: 1280, y: 320, w: 500, h: 200 });
    expect(ops).toEqual([
      { op: "replace", path: "/slides/0/shapes/1/w", value: 500 },
    ]);
    expect(
      boxOps(slide, 0, "ln_capture_asr", { x: 0, y: 0, w: 1, h: 1 })
    ).toEqual([]);
  });
});

describe("insertOps", () => {
  it("adds the shape on top", () => {
    const shape = {
      id: "sh_new1",
      kind: "rect",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    } as Shape;
    expect(ids(apply(insertOps(0, shape)).shapes).at(-1)).toBe("sh_new1");
  });
});

describe("reorderOps", () => {
  it("brings shapes to the front in their own order", () => {
    const ops = reorderOps(
      slide,
      0,
      new Set(["sh_asr", "sh_capture"]),
      "front"
    );
    expect(ids(apply(ops).shapes)).toEqual([
      "sh_router",
      "ln_capture_asr",
      "ln_capture_router",
      "tx_note",
      "im_demo",
      "sh_capture",
      "sh_asr",
    ]);
  });

  it("sends shapes to the back in their own order", () => {
    const ops = reorderOps(slide, 0, new Set(["im_demo", "tx_note"]), "back");
    expect(ids(apply(ops).shapes).slice(0, 3)).toEqual([
      "tx_note",
      "im_demo",
      "sh_capture",
    ]);
  });

  it("returns nothing when the shapes are already there", () => {
    expect(reorderOps(slide, 0, new Set(["im_demo"]), "front")).toEqual([]);
    expect(reorderOps(slide, 0, new Set(["sh_capture"]), "back")).toEqual([]);
  });
});

describe("deleteOps", () => {
  it("deletes shapes and leaves connectors glued to them where they were", () => {
    const after = apply(
      deleteOps(slide, 0, new Set(["sh_capture", "tx_note"]))
    );
    expect(ids(after.shapes)).toEqual([
      "sh_asr",
      "sh_router",
      "ln_capture_asr",
      "ln_capture_router",
      "im_demo",
    ]);
    // sh_capture's right site (3) was at (640, 420), its bottom (2) at (400, 520).
    expect(find(after.shapes, "ln_capture_asr")).toMatchObject({
      start: { x: 640, y: 420 },
      end: { shape: "sh_asr", site: 1 },
    });
    expect(find(after.shapes, "ln_capture_router")).toMatchObject({
      start: { x: 400, y: 520 },
    });
  });

  it("deletes a connector along with the shape it is glued to", () => {
    const after = apply(
      deleteOps(slide, 0, new Set(["sh_capture", "ln_capture_asr"]))
    );
    expect(ids(after.shapes)).not.toContain("ln_capture_asr");
  });
});

describe("previews", () => {
  it("show what the patches store", () => {
    const picked = new Set(["sh_capture", "tx_note"]);
    expect(movedSlide(slide, picked, 12.345, 6)).toEqual(
      apply(moveOps(slide, 0, picked, 12.345, 6))
    );
    const box = { x: 1300.004, y: 300, w: 400, h: 240 };
    expect(resizedSlide(slide, "sh_asr", box)).toEqual(
      apply(boxOps(slide, 0, "sh_asr", box))
    );
  });

  it("insert new shapes where they stay visible", () => {
    const first = newShape("roundRect", slide);
    const crowded = { ...slide, shapes: [...slide.shapes, first] };
    const second = newShape("roundRect", crowded);
    expect(first).toMatchObject({ kind: "roundRect", x: 720, y: 440 });
    expect(second).toMatchObject({ x: 760, y: 480 });
    expect(second.id).not.toBe(first.id);
    expect(ids(apply(insertOps(0, second)).shapes).at(-1)).toBe(second.id);
  });
});
