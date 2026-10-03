// JSON Patch operations for editor gestures. A gesture becomes one patch for
// mutateDeck, addressed by the shapes' positions in the document it was made
// against; the base version guarantees those positions still hold.
import type { Operation } from "../deck/patch";
import type { Shape, Slide } from "../deck/schema";
import { sitePoint } from "../render/connector";
import { type Box, tidy } from "./geometry";

const shapePath = (slide: number, index: number) =>
  `/slides/${slide}/shapes/${index}`;

/**
 * Moves shapes by (dx, dy): boxes, and the ends of connectors that are not
 * glued. A glued end follows its shape, so it is never written.
 */
export function moveOps(
  slide: Slide,
  slideIndex: number,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number
): Operation[] {
  const ops: Operation[] = [];
  slide.shapes.forEach((shape, i) => {
    if (!ids.has(shape.id)) return;
    const path = shapePath(slideIndex, i);
    if (shape.kind === "line") {
      for (const side of ["start", "end"] as const) {
        const end = shape[side];
        if (!("x" in end)) continue;
        ops.push({
          op: "replace",
          path: `${path}/${side}`,
          value: { x: tidy(end.x + dx), y: tidy(end.y + dy) },
        });
      }
      return;
    }
    ops.push(
      { op: "replace", path: `${path}/x`, value: tidy(shape.x + dx) },
      { op: "replace", path: `${path}/y`, value: tidy(shape.y + dy) }
    );
  });
  return ops;
}

/** Sets a box's position and size, writing only what changed. */
export function boxOps(
  slide: Slide,
  slideIndex: number,
  id: string,
  box: Box
): Operation[] {
  const index = slide.shapes.findIndex((shape) => shape.id === id);
  const shape = slide.shapes[index];
  if (!shape || shape.kind === "line") return [];
  return (["x", "y", "w", "h"] as const)
    .filter((key) => tidy(box[key]) !== shape[key])
    .map((key) => ({
      op: "replace",
      path: `${shapePath(slideIndex, index)}/${key}`,
      value: tidy(box[key]),
    }));
}

/** Adds a shape on top of the others. */
export function insertOps(slideIndex: number, shape: Shape): Operation[] {
  return [{ op: "add", path: `/slides/${slideIndex}/shapes/-`, value: shape }];
}

/**
 * Brings shapes to the front or sends them to the back, keeping their order
 * among themselves. Returns no operations when nothing would move.
 */
export function reorderOps(
  slide: Slide,
  slideIndex: number,
  ids: ReadonlySet<string>,
  to: "front" | "back"
): Operation[] {
  const order = slide.shapes.map((shape) => shape.id);
  const picked = order.filter((id) => ids.has(id));
  const rest = order.filter((id) => !ids.has(id));
  const target = to === "front" ? [...rest, ...picked] : [...picked, ...rest];
  if (target.every((id, i) => id === order[i])) return [];

  const ops: Operation[] = [];
  target.forEach((id, k) => {
    const from = order.indexOf(id);
    if (from === k) return;
    order.splice(from, 1);
    order.splice(k, 0, id);
    ops.push({
      op: "move",
      from: shapePath(slideIndex, from),
      path: shapePath(slideIndex, k),
    });
  });
  return ops;
}

/**
 * Deletes shapes. A connector that stays but was glued to a deleted shape
 * keeps its end where it was, unglued, as PowerPoint does.
 */
export function deleteOps(
  slide: Slide,
  slideIndex: number,
  ids: ReadonlySet<string>
): Operation[] {
  const shapes = new Map(slide.shapes.map((shape) => [shape.id, shape]));
  const ops: Operation[] = [];
  slide.shapes.forEach((shape, i) => {
    if (shape.kind !== "line" || ids.has(shape.id)) return;
    for (const side of ["start", "end"] as const) {
      const end = shape[side];
      if (!("shape" in end) || !ids.has(end.shape)) continue;
      const target = shapes.get(end.shape);
      if (!target || target.kind === "line") continue;
      const { point } = sitePoint(target, end.site);
      ops.push({
        op: "replace",
        path: `${shapePath(slideIndex, i)}/${side}`,
        value: { x: tidy(point.x), y: tidy(point.y) },
      });
    }
  });
  // Remove from the end, so earlier positions stay valid.
  for (let i = slide.shapes.length - 1; i >= 0; i--) {
    if (ids.has(slide.shapes[i].id)) {
      ops.push({ op: "remove", path: shapePath(slideIndex, i) });
    }
  }
  return ops;
}
