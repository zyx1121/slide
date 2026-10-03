// Editor geometry on the 1920 x 1080 canvas: which shape is under a point,
// which shapes a marquee holds, where a shape's bounds are, and how a box
// changes when one of its handles is dragged. Pure functions, shared by the
// editor and its tests.
import type { Shape, Slide } from "../deck/schema";
import { type Point, type Rect, routeConnector } from "../render/connector";

export type { Point, Rect };
export type BoxShape = Exclude<Shape, { kind: "line" }>;
export type LineShape = Extract<Shape, { kind: "line" }>;
export type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
};

/** The smallest width or height a resize leaves, in px. */
export const MIN_SIZE = 4;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function turn(p: Point, degrees: number): Point {
  if (!degrees) return p;
  const r = radians(degrees);
  return {
    x: p.x * Math.cos(r) - p.y * Math.sin(r),
    y: p.x * Math.sin(r) + p.y * Math.cos(r),
  };
}

const centerOf = (box: Box): Point => ({
  x: box.x + box.w / 2,
  y: box.y + box.h / 2,
});

/** A canvas point in a box's own frame: unturned, from the box's center. */
export function toLocal(box: Box, p: Point): Point {
  const c = centerOf(box);
  return turn({ x: p.x - c.x, y: p.y - c.y }, -(box.rotation ?? 0));
}

/** True when the point is on the shape, within `tolerance` px of its edge. */
export function containsPoint(
  shape: BoxShape,
  p: Point,
  tolerance = 0
): boolean {
  const local = toLocal(shape, p);
  const hw = shape.w / 2 + tolerance;
  const hh = shape.h / 2 + tolerance;
  if (shape.kind === "ellipse") {
    if (hw <= 0 || hh <= 0) return false;
    return (
      (local.x * local.x) / (hw * hw) + (local.y * local.y) / (hh * hh) <= 1
    );
  }
  return Math.abs(local.x) <= hw && Math.abs(local.y) <= hh;
}

/** The points a connector is drawn through; curves are sampled. */
export function linePoints(
  line: LineShape,
  shapes: ReadonlyMap<string, Shape>
): Point[] {
  const route = routeConnector(line, shapes);
  if (route.kind === "polyline") return route.points;
  const [p0, p1, p2, p3] = route.points;
  const points: Point[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    points.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
  }
  return points;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)
        );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The topmost shape under a point, or null. A connector counts within
 * `tolerance` px of its line; a box counts anywhere inside it, filled or not,
 * so text boxes and outlines are easy to pick.
 */
export function hitTest(
  slide: Slide,
  p: Point,
  tolerance: number
): string | null {
  const shapes = new Map(slide.shapes.map((shape) => [shape.id, shape]));
  for (let i = slide.shapes.length - 1; i >= 0; i--) {
    const shape = slide.shapes[i];
    if (shape.kind === "line") {
      const points = linePoints(shape, shapes);
      const reach = tolerance + shape.stroke.width / 2;
      for (let j = 1; j < points.length; j++) {
        if (distanceToSegment(p, points[j - 1], points[j]) <= reach) {
          return shape.id;
        }
      }
    } else if (containsPoint(shape, p)) {
      return shape.id;
    }
  }
  return null;
}

/** The axis-aligned box around points. */
export function boundsOfPoints(points: Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The four corners of a box on the canvas, turned with it. */
export function cornersOf(box: Box): Point[] {
  const c = centerOf(box);
  return [
    { x: -box.w / 2, y: -box.h / 2 },
    { x: box.w / 2, y: -box.h / 2 },
    { x: box.w / 2, y: box.h / 2 },
    { x: -box.w / 2, y: box.h / 2 },
  ].map((corner) => {
    const p = turn(corner, box.rotation ?? 0);
    return { x: c.x + p.x, y: c.y + p.y };
  });
}

/** The axis-aligned box around a shape as drawn. */
export function shapeBounds(
  shape: Shape,
  shapes: ReadonlyMap<string, Shape>
): Rect {
  return boundsOfPoints(
    shape.kind === "line" ? linePoints(shape, shapes) : cornersOf(shape)
  );
}

/** The box around several boxes; null for none. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  return boundsOfPoints(
    rects.flatMap((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
    ])
  );
}

/** The ids of the shapes a marquee holds entirely, as PowerPoint selects. */
export function shapesInRect(slide: Slide, rect: Rect): string[] {
  const shapes = new Map(slide.shapes.map((shape) => [shape.id, shape]));
  return slide.shapes
    .filter((shape) => {
      const b = shapeBounds(shape, shapes);
      return (
        b.x >= rect.x &&
        b.y >= rect.y &&
        b.x + b.w <= rect.x + rect.w &&
        b.y + b.h <= rect.y + rect.h
      );
    })
    .map((shape) => shape.id);
}

/** The rectangle two drag points span. */
export function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const OPPOSITE: Record<Handle, Handle> = {
  n: "s",
  s: "n",
  e: "w",
  w: "e",
  ne: "sw",
  nw: "se",
  se: "nw",
  sw: "ne",
};

/** Where a handle sits on a box's own frame, from its center. */
function handleOffset(handle: Handle, w: number, h: number): Point {
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  return { x: (sx * w) / 2, y: (sy * h) / 2 };
}

/** Where a handle sits on the canvas. */
export function handlePoint(box: Box, handle: Handle): Point {
  const c = centerOf(box);
  const p = turn(handleOffset(handle, box.w, box.h), box.rotation ?? 0);
  return { x: c.x + p.x, y: c.y + p.y };
}

/**
 * The box after dragging `handle` by `delta` canvas px. The opposite edge or
 * corner stays where it is on the canvas, for a turned box too. With
 * `keepAspect` (Shift, as in PowerPoint) the width-to-height ratio holds, and
 * an edge handle then grows the box evenly about its center line. Sizes stop
 * at MIN_SIZE: a handle cannot be dragged past the opposite side.
 */
export function resizeBox(
  box: Box,
  handle: Handle,
  delta: Point,
  keepAspect = false
): Box {
  const rotation = box.rotation ?? 0;
  const local = turn(delta, -rotation);
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  let w = box.w + sx * local.x;
  let h = box.h + sy * local.y;
  if (keepAspect && box.w > 0 && box.h > 0) {
    const ratio = box.w / box.h;
    if (sx !== 0 && sy !== 0) {
      if (Math.abs(w / box.w) >= Math.abs(h / box.h)) h = w / ratio;
      else w = h * ratio;
    } else if (sx !== 0) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
  }
  w = Math.max(MIN_SIZE, w);
  h = Math.max(MIN_SIZE, h);

  // Keep the opposite handle fixed on the canvas.
  const before = handleOffset(OPPOSITE[handle], box.w, box.h);
  const after = handleOffset(OPPOSITE[handle], w, h);
  const shift = turn(
    { x: before.x - after.x, y: before.y - after.y },
    rotation
  );
  const c = centerOf(box);
  return {
    ...box,
    x: c.x + shift.x - w / 2,
    y: c.y + shift.y - h / 2,
    w,
    h,
  };
}

/** Rounds a coordinate to 0.01 px, so documents stay readable. */
export function tidy(value: number): number {
  return Math.round(value * 100) / 100;
}
