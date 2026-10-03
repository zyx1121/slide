// The slide as it looks in the middle of a gesture, before the gesture is
// written as a patch. Mirrors ops.ts: what a drag shows is what its patch
// stores (ops.test.ts checks the two agree).
import type { Shape, Slide } from "../deck/schema";
import { newId } from "../ids";
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

export type NewShapeKind = "rect" | "roundRect" | "ellipse";

/**
 * A new shape in WinLab's usual style (light blue fill, blue outline),
 * centered on the slide, or stepped down and right when another shape
 * already sits there, so repeated inserts stay visible.
 */
export function newShape(kind: NewShapeKind, slide: Slide): Shape {
  const w = kind === "ellipse" ? 320 : 480;
  const h = kind === "ellipse" ? 320 : 200;
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
