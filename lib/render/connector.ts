// Connector geometry: where a glued end sits on its shape, and the route a
// straight, elbow or curved connector takes between its two ends. Elbows leave
// and enter perpendicular to the shape's side, go around the shapes they
// connect, and take as few bends as that allows, as PowerPoint's
// bentConnector2 to 5 do.
import type { Shape } from "../deck/schema";

export type Point = { x: number; y: number };
export type Dir = "up" | "down" | "left" | "right";

type LineShape = Extract<Shape, { kind: "line" }>;
type BoxShape = Exclude<Shape, LineShape>;

export type Route =
  | { kind: "polyline"; points: Point[] }
  | { kind: "curve"; points: [Point, Point, Point, Point] };

const SITE_DIRS: Dir[] = ["up", "left", "down", "right"];
const VECTORS: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
/** How far an elbow runs straight out of a shape before it may turn back. */
const STUB = 30;

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

function rotate(p: Point, center: Point, degrees: number): Point {
  if (!degrees) return p;
  const r = (degrees * Math.PI) / 180;
  const d = sub(p, center);
  return {
    x: center.x + d.x * Math.cos(r) - d.y * Math.sin(r),
    y: center.y + d.x * Math.sin(r) + d.y * Math.cos(r),
  };
}

function rotateDir(dir: Dir, degrees: number): Dir {
  const order: Dir[] = ["up", "right", "down", "left"];
  const steps = Math.round((((degrees % 360) + 360) % 360) / 90) % 4;
  return order[(order.indexOf(dir) + steps) % 4];
}

/** A glued end: site 0 top, 1 left, 2 bottom, 3 right, turned with the shape. */
export function sitePoint(
  shape: BoxShape,
  site: number
): { point: Point; dir: Dir } {
  const { x, y, w, h } = shape;
  const local = [
    { x: x + w / 2, y },
    { x, y: y + h / 2 },
    { x: x + w / 2, y: y + h },
    { x: x + w, y: y + h / 2 },
  ][site];
  const rotation = shape.rotation ?? 0;
  return {
    point: rotate(local, { x: x + w / 2, y: y + h / 2 }, rotation),
    dir: rotateDir(SITE_DIRS[site], rotation),
  };
}

/** A free end faces the other end along the axis it is farther away on. */
function facing(from: Point, toward: Point): Dir {
  const d = sub(toward, from);
  if (Math.abs(d.x) >= Math.abs(d.y)) return d.x >= 0 ? "right" : "left";
  return d.y >= 0 ? "down" : "up";
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Drops repeated points and merges straight runs, but never a reversal. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  const same = (p: Point, q: Point) =>
    Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && same(last, p)) continue;
    const before = out[out.length - 2];
    if (before && last) {
      const d1 = sub(last, before);
      const d2 = sub(p, last);
      const cross = d1.x * d2.y - d1.y * d2.x;
      if (Math.abs(cross) < 1e-6 && dot(d1, d2) > 0) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** True when an axis-aligned segment runs through a box's interior. */
function crosses(a: Point, b: Point, r: Rect): boolean {
  const eps = 1e-6;
  if (Math.abs(a.y - b.y) < eps) {
    const [x1, x2] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
    return (
      a.y > r.y + eps &&
      a.y < r.y + r.h - eps &&
      x2 > r.x + eps &&
      x1 < r.x + r.w - eps
    );
  }
  const [y1, y2] = a.y < b.y ? [a.y, b.y] : [b.y, a.y];
  return (
    a.x > r.x + eps &&
    a.x < r.x + r.w - eps &&
    y2 > r.y + eps &&
    y1 < r.y + r.h - eps
  );
}

/** A route's cost: running through a connected shape first, then doubling back, bends, length. */
function cost(points: Point[], obstacles: Rect[]): number {
  let length = 0;
  let through = 0;
  let back = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (const r of obstacles) if (crosses(a, b, r)) through++;
    if (i >= 2 && dot(sub(a, points[i - 2]), sub(b, a)) < 0) back++;
  }
  return through * 1e7 + back * 1e6 + (points.length - 2) * 40 + length;
}

/**
 * An orthogonal route from `a` leaving along `da` to `b` entering against
 * `db`. It runs a short stub straight out of each end, then joins the stubs
 * with the cheapest of a few one- and two-bend paths, including detours
 * around `obstacles` (the boxes of the shapes it connects), so it never runs
 * through them when the shapes leave room.
 */
export function elbowRoute(
  a: Point,
  da: Dir,
  b: Point,
  db: Dir,
  obstacles: Rect[] = []
): Point[] {
  const a1 = add(a, scale(VECTORS[da], STUB));
  const b1 = add(b, scale(VECTORS[db], STUB));
  // The middle line first: among routes of equal cost, the symmetric one wins.
  const xs = [(a1.x + b1.x) / 2, a1.x, b1.x];
  const ys = [(a1.y + b1.y) / 2, a1.y, b1.y];
  for (const r of obstacles) {
    xs.push(r.x - STUB, r.x + r.w + STUB);
    ys.push(r.y - STUB, r.y + r.h + STUB);
  }
  const candidates: Point[][] = [
    ...xs.map((x) => [a, a1, { x, y: a1.y }, { x, y: b1.y }, b1, b]),
    ...ys.map((y) => [a, a1, { x: a1.x, y }, { x: b1.x, y }, b1, b]),
  ];
  let best: Point[] = [];
  let bestCost = Infinity;
  for (const candidate of candidates) {
    const route = simplify(candidate);
    const c = cost(route, obstacles);
    if (c < bestCost) {
      best = route;
      bestCost = c;
    }
  }
  return best;
}

/** The axis-aligned box around a shape, turned or not. */
function boundsOf(shape: BoxShape): Rect {
  const rotation = shape.rotation ?? 0;
  if (!rotation) return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  const center = { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
  const corners = [
    { x: shape.x, y: shape.y },
    { x: shape.x + shape.w, y: shape.y },
    { x: shape.x, y: shape.y + shape.h },
    { x: shape.x + shape.w, y: shape.y + shape.h },
  ].map((p) => rotate(p, center, rotation));
  const minX = Math.min(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  return {
    x: minX,
    y: minY,
    w: Math.max(...corners.map((p) => p.x)) - minX,
    h: Math.max(...corners.map((p) => p.y)) - minY,
  };
}

/** The route of a connector on a slide whose shapes are `shapes`. */
export function routeConnector(
  line: LineShape,
  shapes: ReadonlyMap<string, Shape>
): Route {
  const obstacles: Rect[] = [];
  const resolve = (end: LineShape["start"]) => {
    if ("shape" in end) {
      const target = shapes.get(end.shape);
      if (target && target.kind !== "line") {
        obstacles.push(boundsOf(target));
        return sitePoint(target, end.site);
      }
    }
    return { point: "x" in end ? { x: end.x, y: end.y } : { x: 0, y: 0 } };
  };
  const start = resolve(line.start);
  const end = resolve(line.end);
  const ds = "dir" in start ? start.dir : facing(start.point, end.point);
  const de = "dir" in end ? end.dir : facing(end.point, start.point);

  if (line.route === "straight") {
    return { kind: "polyline", points: [start.point, end.point] };
  }
  if (line.route === "elbow") {
    return {
      kind: "polyline",
      points: elbowRoute(start.point, ds, end.point, de, obstacles),
    };
  }
  const span = Math.hypot(
    end.point.x - start.point.x,
    end.point.y - start.point.y
  );
  const reach = Math.max(40, span / 2);
  return {
    kind: "curve",
    points: [
      start.point,
      add(start.point, scale(VECTORS[ds], reach)),
      add(end.point, scale(VECTORS[de], reach)),
      end.point,
    ],
  };
}
