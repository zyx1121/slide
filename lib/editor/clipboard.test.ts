import { describe, expect, it } from "vitest";

import { applyOperations } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import type { DeckDocument, Shape } from "../deck/schema";
import { copyShapes, parseClip, pasteOffset, pasteShapes } from "./clipboard";
import { insertOps } from "./ops";

const doc = sampleDocument();
const slide = doc.slides[0];
const find = (shapes: Shape[], id: string) =>
  shapes.find((shape) => shape.id === id)!;

describe("copyShapes", () => {
  it("keeps glue inside the clip and unglues ends that leave it", () => {
    const clip = copyShapes(slide, new Set(["sh_capture", "ln_capture_asr"]))!;
    expect(clip.shapes.map((shape) => shape.id)).toEqual([
      "sh_capture",
      "ln_capture_asr",
    ]);
    // sh_asr stays behind: its left site (1) was at (1280, 420).
    expect(find(clip.shapes, "ln_capture_asr")).toMatchObject({
      start: { shape: "sh_capture", site: 3 },
      end: { x: 1280, y: 420 },
    });
  });

  it("copies nothing from an empty selection", () => {
    expect(copyShapes(slide, new Set())).toBeNull();
  });
});

describe("parseClip", () => {
  it("reads back what was copied, and nothing else", () => {
    const clip = copyShapes(slide, new Set(["sh_asr"]))!;
    expect(parseClip(JSON.stringify(clip))).toEqual(clip);
    expect(parseClip("Audio capture")).toBeNull();
    expect(parseClip(undefined)).toBeNull();
    const broken = { ...clip, shapes: [{ ...clip.shapes[0], w: -5 }] };
    expect(parseClip(JSON.stringify(broken))).toBeNull();
  });

  it("still reads a clip copied under the old name", () => {
    const clip = copyShapes(slide, new Set(["sh_asr"]))!;
    const old = { ...clip, format: "slide.winlab.tw/shapes" };
    expect(parseClip(JSON.stringify(old))).toEqual(clip);
    expect(
      parseClip(JSON.stringify({ ...clip, format: "other/shapes" }))
    ).toBeNull();
  });
});

describe("pasteShapes", () => {
  const clip = copyShapes(
    slide,
    new Set(["sh_capture", "sh_asr", "ln_capture_asr", "ln_capture_router"])
  )!;

  it("gives every shape a new id, and glue follows its shape", () => {
    const pasted = pasteShapes(clip, 20);
    const ids = pasted.map((shape) => shape.id);
    expect(new Set(ids).size).toBe(4);
    for (const [i, shape] of pasted.entries()) {
      expect(shape.id).not.toBe(clip.shapes[i].id);
      expect(shape.id.split("_")[0]).toBe(clip.shapes[i].id.split("_")[0]);
    }
    const [capture, asr, straight, elbow] = pasted;
    expect(straight).toMatchObject({
      start: { shape: capture.id, site: 3 },
      end: { shape: asr.id, site: 1 },
    });
    // The elbow's router was left out: its free end moves with the paste.
    expect(elbow).toMatchObject({
      start: { shape: capture.id },
      end: { x: 1300, y: 840 },
    });
    expect(capture).toMatchObject({ x: 180, y: 340 });
  });

  it("pastes onto the same slide and onto another one", () => {
    const pasted = pasteShapes(clip, 20);
    const same = applyOperations(
      doc,
      pasted.flatMap((shape) => insertOps(0, shape))
    ).document;
    expect(same.slides[0].shapes).toHaveLength(slide.shapes.length + 4);

    const twoSlides: DeckDocument = {
      ...doc,
      slides: [...doc.slides, { id: "sl_second", title: "", shapes: [] }],
    };
    const other = applyOperations(
      twoSlides,
      pasteShapes(clip, 0).flatMap((shape) => insertOps(1, shape))
    ).document;
    expect(other.slides[1].shapes).toHaveLength(4);
  });
});

describe("pasteOffset", () => {
  const clip = copyShapes(slide, new Set(["sh_capture"]))!;

  it("steps a paste off the shapes it would cover", () => {
    expect(pasteOffset(slide, clip)).toBe(20);
    const once = applyOperations(
      doc,
      pasteShapes(clip, 20).flatMap((shape) => insertOps(0, shape))
    ).document.slides[0];
    expect(pasteOffset(once, clip)).toBe(40);
  });

  it("steps a connector off the glued one it was copied from", () => {
    // Both ends of ln_capture_asr are glued to shapes left out of the clip,
    // so the copy holds free ends exactly where the original is drawn.
    const line = copyShapes(slide, new Set(["ln_capture_asr"]))!;
    expect(pasteOffset(slide, line)).toBe(20);
  });

  it("leaves a paste where it was on a slide with room", () => {
    expect(pasteOffset({ id: "sl_empty", title: "", shapes: [] }, clip)).toBe(
      0
    );
  });
});
