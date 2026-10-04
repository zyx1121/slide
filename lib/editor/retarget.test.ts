import { describe, expect, it } from "vitest";

import { DeckError } from "../deck/errors";
import { applyOperations, type Operation } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import type { DeckDocument } from "../deck/schema";
import { guard } from "./guard";
import { deleteOps, moveOps, reorderOps } from "./ops";
import { retarget } from "./retarget";

const doc = sampleDocument();
const slide = doc.slides[0];

/** The sample deck with a slide inserted before its own, as an agent adds one. */
function withSlideBefore(): DeckDocument {
  return applyOperations(doc, [
    {
      op: "add",
      path: "/slides/0",
      value: { id: "sl_agent", title: "Agent", shapes: [] },
    },
  ]).document;
}

/** The sample deck without its first shape, as an agent deleted it. */
function withoutCapture(): DeckDocument {
  return applyOperations(doc, deleteOps(slide, 0, new Set(["sh_capture"])))
    .document;
}

const ids = (document: DeckDocument, at = 0) =>
  document.slides[at].shapes.map((shape) => shape.id);

describe("retarget", () => {
  it("leaves a patch as it is when nothing moved", () => {
    const patch = guard(doc, moveOps(slide, 0, new Set(["sh_asr"]), 10, 0));
    expect(retarget(doc, patch)).toEqual(patch);
  });

  it("follows a slide that moved down when one was inserted before it", () => {
    const patch = guard(doc, moveOps(slide, 0, new Set(["sh_asr"]), 10, 0));
    const there = withSlideBefore();
    const moved = retarget(there, patch);
    expect(moved.map((op) => op.path)).toEqual([
      "/slides/1/id",
      "/slides/1/shapes/1/id",
      "/slides/1/shapes/1/x",
      "/slides/1/shapes/1/y",
    ]);
    const result = applyOperations(there, moved).document;
    expect(result.slides[1].shapes[1]).toMatchObject({ id: "sh_asr", x: 1290 });
    expect(result.slides[0]).toEqual(there.slides[0]);
  });

  it("follows a shape that moved up when one below it was deleted", () => {
    const patch = guard(doc, moveOps(slide, 0, new Set(["sh_asr"]), 10, 0));
    const there = withoutCapture();
    const result = applyOperations(there, retarget(there, patch)).document;
    expect(result.slides[0].shapes[0]).toMatchObject({ id: "sh_asr", x: 1290 });
  });

  it("follows a title being typed onto a slide that moved", () => {
    const patch = guard(doc, [
      { op: "replace", path: "/slides/0/title", value: "Typed" },
    ]);
    const there = withSlideBefore();
    const result = applyOperations(there, retarget(there, patch)).document;
    expect(result.slides.map((s) => s.title)).toEqual(["Agent", "Typed"]);
  });

  it("follows positions through a patch that moves them itself", () => {
    const patch = guard(
      doc,
      deleteOps(slide, 0, new Set(["sh_router", "tx_note"]))
    );
    const there = withoutCapture();
    const result = applyOperations(there, retarget(there, patch)).document;
    expect(ids(result)).toEqual([
      "sh_asr",
      "ln_capture_asr",
      "ln_capture_router",
      "im_demo",
    ]);
  });

  it("brings a shape to the front of a slide that moved", () => {
    const patch = guard(
      doc,
      reorderOps(slide, 0, new Set(["sh_capture"]), "front")
    );
    const there = withSlideBefore();
    const result = applyOperations(there, retarget(there, patch)).document;
    expect(ids(result, 1).at(-1)).toBe("sh_capture");
    expect(ids(result, 1)).toHaveLength(slide.shapes.length);
  });

  it("keeps an insert past the end of a list that got shorter at its end", () => {
    const patch: Operation[] = [
      { op: "test", path: "/slides/0/id", value: "sl_overview" },
      {
        op: "add",
        path: "/slides/0/shapes/7",
        value: { ...slide.shapes[0], id: "sh_new" },
      },
    ];
    const there = withoutCapture();
    const moved = retarget(there, patch);
    expect(moved[1].path).toBe("/slides/0/shapes/6");
    expect(ids(applyOperations(there, moved).document).at(-1)).toBe("sh_new");
  });

  it("leaves a patch whose shape is gone to be refused", () => {
    const patch = guard(doc, moveOps(slide, 0, new Set(["sh_capture"]), 10, 0));
    const there = withoutCapture();
    expect(() => applyOperations(there, retarget(there, patch))).toThrow(
      DeckError
    );
  });
});
