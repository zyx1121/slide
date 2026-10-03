// Connector geometry: where a glued end sits on its shape, and the route a
// straight, elbow or curved connector takes between its two ends. Elbows leave
// and enter perpendicular to the shape's side, with as few bends as the ends
// allow, the way PowerPoint routes bentConnector2 to 5.
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
const horizontal = (d: Dir) => d === "left" || d === "right";

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

function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6)
      continue;
    const before = out[out.length - 2];
    if (
      before &&
      last &&
      ((Math.abs(before.x - last.x) < 1e-6 && Math.abs(last.x - p.x) < 1e-6) ||
        (Math.abs(before.y - last.y) < 1e-6 && Math.abs(last.y - p.y) < 1e-6))
    ) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** An orthogonal route from `a` leaving along `da` to `b` entering against `db`. */
export function elbowRoute(a: Point, da: Dir, b: Point, db: Dir): Point[] {
  const va = VECTORS[da];
  const vb = VECTORS[db];
  const ahead = (p: Point, from: Point, v: Point) => dot(sub(p, from), v) >= 0;

  if (horizontal(da) !== horizontal(db)) {
    // One bend where the two axes meet, when both ends can reach it.
    const corner = horizontal(da) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    if (ahead(corner, a, va) && ahead(corner, b, vb)) {
      return simplify([a, corner, b]);
    }
    const a1 = add(a, scale(va, STUB));
    const b1 = add(b, scale(vb, STUB));
    const turn = horizontal(da) ? { x: a1.x, y: b1.y } : { x: b1.x, y: a1.y };
    return simplify([a, a1, turn, b1, b]);
  }

  if (dot(va, vb) < 0) {
    // Facing each other: two bends halfway between, or around when behind.
    const mid = horizontal(da)
      ? { x: (a.x + b.x) / 2, y: 0 }
      : { x: 0, y: (a.y + b.y) / 2 };
    const m1 = horizontal(da) ? { x: mid.x, y: a.y } : { x: a.x, y: mid.y };
    const m2 = horizontal(da) ? { x: mid.x, y: b.y } : { x: b.x, y: mid.y };
    if (ahead(m1, a, va) && ahead(m2, b, vb)) return simplify([a, m1, m2, b]);
    const a1 = add(a, scale(va, STUB));
    const b1 = add(b, scale(vb, STUB));
    const across = horizontal(da)
      ? [
          { x: a1.x, y: (a.y + b.y) / 2 },
          { x: b1.x, y: (a.y + b.y) / 2 },
        ]
      : [
          { x: (a.x + b.x) / 2, y: a1.y },
          { x: (a.x + b.x) / 2, y: b1.y },
        ];
    return simplify([a, a1, ...across, b1, b]);
  }

  // Same side: out past the farther end, across, and back in.
  if (horizontal(da)) {
    const x =
      da === "right" ? Math.max(a.x, b.x) + STUB : Math.min(a.x, b.x) - STUB;
    return simplify([a, { x, y: a.y }, { x, y: b.y }, b]);
  }
  const y =
    da === "down" ? Math.max(a.y, b.y) + STUB : Math.min(a.y, b.y) - STUB;
  return simplify([a, { x: a.x, y }, { x: b.x, y }, b]);
}

/** The route of a connector on a slide whose shapes are `shapes`. */
export function routeConnector(
  line: LineShape,
  shapes: ReadonlyMap<string, Shape>
): Route {
  const resolve = (end: LineShape["start"]) => {
    if ("shape" in end) {
      const target = shapes.get(end.shape);
      if (target && target.kind !== "line") return sitePoint(target, end.site);
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
      points: elbowRoute(start.point, ds, end.point, de),
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
