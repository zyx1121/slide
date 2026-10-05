// Copy and paste of shapes. A clip holds the selected shapes as they are,
// back to front. A connector end glued to a shape left out of the clip is
// unglued at copy time, where its shape still is, so it pastes where it was.
import * as z from "zod";

import { type Layout, Shape, type Slide } from "../deck/schema";
import { newId } from "../ids";
import { sitePoint } from "../render/connector";
import { type Point, tidy } from "./geometry";
import { bakePlaceholder } from "./placeholders";

/** The clipboard type the editor writes; text/plain carries the same JSON. */
export const CLIP_TYPE = "application/x-slide-shapes+json";

/** What a clip is called. */
const FORMAT = "slide/shapes";

const Clip = z.strictObject({
  format: z.literal(FORMAT),
  version: z.literal(1),
  shapes: z.array(Shape).min(1).max(1000),
});
export type Clip = z.infer<typeof Clip>;

type End = Extract<Shape, { kind: "line" }>["start"];

/**
 * The selected shapes as a clip; null when nothing is selected. A
 * placeholder box goes as a plain text box that looks the same, since the
 * slide it lands on may have no such placeholder.
 */
export function copyShapes(
  slide: Slide,
  ids: ReadonlySet<string>,
  layout?: Layout
): Clip | null {
  const byId = new Map(slide.shapes.map((shape) => [shape.id, shape]));
  const unglue = (end: End): End => {
    if (!("shape" in end) || ids.has(end.shape)) return end;
    const target = byId.get(end.shape);
    if (!target || target.kind === "line") return end;
    const { point } = sitePoint(target, end.site);
    return { x: tidy(point.x), y: tidy(point.y) };
  };
  const shapes = slide.shapes
    .filter((shape) => ids.has(shape.id))
    .map((shape) =>
      shape.kind === "line"
        ? { ...shape, start: unglue(shape.start), end: unglue(shape.end) }
        : shape.kind === "text" && shape.placeholder !== undefined
          ? bakePlaceholder(shape, layout)
          : shape
    );
  if (shapes.length === 0) return null;
  return { format: FORMAT, version: 1, shapes };
}

/** A clip read back from clipboard text; null for anything else. */
export function parseClip(text: string | undefined | null): Clip | null {
  if (!text) return null;
  try {
    const parsed = Clip.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const prefixOf = (id: string) => id.slice(0, id.indexOf("_"));

/**
 * The clip's shapes ready to add: each gets a new id (connectors glued
 * within the clip follow their shapes' new ids) and moves by `offset` px
 * right and down, so a paste over its originals stays visible. Pasted
 * boxes are plain text boxes, unless `samePlace` (a slide copied whole onto
 * its own layout) keeps them its placeholders.
 */
export function pasteShapes(
  clip: Clip,
  offset: number,
  samePlace = false
): Shape[] {
  const ids = new Map(
    clip.shapes.map((shape) => [shape.id, newId(prefixOf(shape.id))])
  );
  const shift = (end: End): End =>
    "shape" in end
      ? { ...end, shape: ids.get(end.shape) ?? end.shape }
      : { x: tidy(end.x + offset), y: tidy(end.y + offset) };
  return clip.shapes.map((shape): Shape => {
    const id = ids.get(shape.id)!;
    if (shape.kind === "line") {
      return { ...shape, id, start: shift(shape.start), end: shift(shape.end) };
    }
    const moved = {
      ...shape,
      id,
      x: tidy(shape.x + offset),
      y: tidy(shape.y + offset),
    };
    if (moved.kind === "text" && !samePlace) delete moved.placeholder;
    return moved;
  });
}

/**
 * Where a shape sits, for telling whether a paste would land on it. A glued
 * connector end sits where its shape's site is, when `shapes` can say.
 */
function anchors(shape: Shape, shapes?: ReadonlyMap<string, Shape>): Point[] {
  if (shape.kind !== "line") return [{ x: shape.x, y: shape.y }];
  return [shape.start, shape.end].flatMap((end) => {
    if ("x" in end) return [{ x: end.x, y: end.y }];
    const target = shapes?.get(end.shape);
    return target && target.kind !== "line"
      ? [sitePoint(target, end.site).point]
      : [];
  });
}

const keyOf = (p: Point) => `${tidy(p.x)},${tidy(p.y)}`;

/**
 * How far to move a paste so it does not land exactly on shapes already on
 * the slide: 0 when the spot is free, else the first free step of 20 px
 * right and down. Repeated pastes and duplicates fan out the same way.
 */
export function pasteOffset(target: Slide, clip: Clip): number {
  const shapes = new Map(target.shapes.map((shape) => [shape.id, shape]));
  const taken = new Set(
    target.shapes.flatMap((shape) => anchors(shape, shapes)).map(keyOf)
  );
  const points = clip.shapes.flatMap((shape) => anchors(shape));
  for (let offset = 0; offset < 2000; offset += 20) {
    const lands = points.some((p) =>
      taken.has(keyOf({ x: p.x + offset, y: p.y + offset }))
    );
    if (!lands) return offset;
  }
  return 0;
}
