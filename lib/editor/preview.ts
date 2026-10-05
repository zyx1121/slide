// The slide as it looks in the middle of a gesture, before the gesture is
// written as a patch. Mirrors ops.ts: what a drag shows is what its patch
// stores (ops.test.ts checks the two agree).
import { compare } from "fast-json-patch";

import type { DeckDocument, Shape, Slide } from "../deck/schema";
import { newId } from "../ids";
import { LINE_HEIGHT } from "../render/metrics";
import { DEFAULT_TEXT } from "../render/text";
import { DEFAULT_INSET } from "../render/text";
import { type Box, tidy } from "./geometry";

/** The slide with shapes moved by (dx, dy); glued connector ends stay glued. */
export function movedSlide(
  slide: Slide,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number
): Slide {
  if (!dx && !dy) return slide;
  return {
    ...slide,
    shapes: slide.shapes.map((shape): Shape => {
      if (!ids.has(shape.id)) return shape;
      if (shape.kind !== "line") {
        return { ...shape, x: tidy(shape.x + dx), y: tidy(shape.y + dy) };
      }
      const move = (end: typeof shape.start) =>
        "x" in end ? { x: tidy(end.x + dx), y: tidy(end.y + dy) } : end;
      return { ...shape, start: move(shape.start), end: move(shape.end) };
    }),
  };
}

/** The slide with one box given a new position and size. */
export function resizedSlide(slide: Slide, id: string, box: Box): Slide {
  return {
    ...slide,
    shapes: slide.shapes.map((shape): Shape =>
      shape.id === id && shape.kind !== "line"
        ? {
            ...shape,
            x: tidy(box.x),
            y: tidy(box.y),
            w: tidy(box.w),
            h: tidy(box.h),
          }
        : shape
    ),
  };
}

export type NewShapeKind = "rect" | "roundRect" | "ellipse" | "text";

/** A new text box's width, and its height: one line of 18 pt text. */
export const TEXT_BOX = {
  w: 640,
  h: tidy(DEFAULT_TEXT.size * LINE_HEIGHT + 2 * DEFAULT_INSET.y),
};

/**
 * A new shape in the usual style (light blue fill, blue outline), or
 * an empty text box without either,
 * centered on the slide, or stepped down and right when another shape
 * already sits there, so repeated inserts stay visible.
 */
export function newShape(kind: NewShapeKind, slide: Slide): Shape {
  const w = kind === "ellipse" ? 320 : kind === "text" ? TEXT_BOX.w : 480;
  const h = kind === "ellipse" ? 320 : kind === "text" ? TEXT_BOX.h : 200;
  let x = (1920 - w) / 2;
  let y = (1080 - h) / 2;
  const taken = (px: number, py: number) =>
    slide.shapes.some(
      (shape) => shape.kind !== "line" && shape.x === px && shape.y === py
    );
  while (taken(x, y) && y < 1080 - h) {
    x += 40;
    y += 40;
  }
  if (kind === "text") {
    return {
      id: newId("sh"),
      kind,
      x,
      y,
      w,
      h,
      text: { paragraphs: [{ runs: [] }] },
    };
  }
  const base = {
    id: newId("sh"),
    x,
    y,
    w,
    h,
    fill: "#e8f1fe",
    stroke: { color: "#4f81bd", width: 3 },
  };
  if (kind === "roundRect") return { ...base, kind, corner: 0.16 };
  return { ...base, kind };
}

/** The largest share of the slide a new picture takes: 80% of each side. */
const IMAGE_FIT = 0.8;
/** Canvas px per image px: 144 canvas px per inch over 96 dpi. */
const IMAGE_SCALE = 1.5;

/**
 * A new picture at its natural size, shrunk to fit 80% of the slide, with
 * its aspect ratio kept, centered on `at` (the slide's center by default)
 * and kept on the slide.
 */
export function newImage(
  asset: { sha256: string; width: number; height: number },
  at: { x: number; y: number } = { x: 960, y: 540 }
): Shape {
  const k = Math.min(
    IMAGE_SCALE,
    (1920 * IMAGE_FIT) / asset.width,
    (1080 * IMAGE_FIT) / asset.height
  );
  const w = tidy(asset.width * k);
  const h = tidy(asset.height * k);
  const x = tidy(Math.max(0, Math.min(1920 - w, at.x - w / 2)));
  const y = tidy(Math.max(0, Math.min(1080 - h, at.y - h / 2)));
  return { id: newId("im"), kind: "image", x, y, w, h, asset: asset.sha256 };
}

/**
 * The new document with every slide that did not change kept as the same
 * object, so the canvases of untouched slides skip drawing them again.
 */
export function shareSlides(
  before: DeckDocument,
  after: DeckDocument
): DeckDocument {
  let shared = false;
  const slides = after.slides.map((slide, i) => {
    const old = before.slides[i];
    if (old && old.id === slide.id && compare(old, slide).length === 0) {
      shared = true;
      return old;
    }
    return slide;
  });
  return shared ? { ...after, slides } : after;
}
