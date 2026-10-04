// A connector's routed path as PowerPoint stores it: a preset connector
// (straightConnector1, bentConnector2 to 5, curvedConnector2 to 5) in a box
// that is flipped, then turned. PowerPoint draws the stored geometry until a
// connected shape moves, so the path must be the one the editor drew
// (PLAN.md, Rule 5). The transform is found by trying every turn and flip,
// and the adjust values follow from the bends.
import type { Point } from "../render/connector";

export type ConnectorGeometry = {
  prst: string;
  /** The unturned box, in px on the slide canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise: 0, 90, 180 or 270. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** Adjust values, in 1/100000 of the box (adj1, adj2, adj3). */
  adjust: number[];
};

const EPS = 0.01;
/**
 * The side a box gets when its path starts and ends level: adjust values are
 * fractions of the box, so a side of 0 could not place the bends. PowerPoint
 * does the same with a side of 1 pt and large adjust values.
 */
const THIN = 0.5;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

/** A point moved from the slide into the box's frame, given its center. */
function toLocal(
  p: Point,
  center: Point,
  rotation: number,
  flipH: boolean,
  flipV: boolean
): Point {
  const r = (-rotation * Math.PI) / 180;
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  let x = dx * Math.cos(r) - dy * Math.sin(r);
  let y = dx * Math.sin(r) + dy * Math.cos(r);
  if (flipH) x = -x;
  if (flipV) y = -y;
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

/** Drops repeated points and merges runs that go on straight. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && near(last.x, p.x) && near(last.y, p.y)) continue;
    const before = out[out.length - 2];
    if (
      before &&
      last &&
      ((near(before.x, last.x) && near(last.x, p.x)) ||
        (near(before.y, last.y) && near(last.y, p.y)))
    ) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * The adjust values of a bent connector whose local path (from (0, 0) to
 * (w, h)) is `local`: it must start along x and alternate, with as many
 * bends as the preset has. Null when it does not fit.
 */
function bentAdjust(local: Point[], w: number, h: number): number[] | null {
  // Within a thin box's half side: its ends sit THIN / 2 off the route's.
  const level = (a: number, b: number) => Math.abs(a - b) <= THIN / 2 + EPS;
  const bends = local.length - 2;
  if (bends < 1 || bends > 4) return null;
  for (let i = 1; i < local.length; i++) {
    const along = i % 2 === 1 ? "y" : "x";
    // Odd segments run along x (y stays), even ones along y (x stays).
    if (!level(local[i][along], local[i - 1][along])) return null;
  }
  const ratio = (value: number, size: number) => (value / size) * 100000;
  const adjust: number[] = [];
  if (bends === 1) {
    // bentConnector2: (0,0) (w,0) (w,h).
    return level(local[1].x, w) && level(local[1].y, 0) ? [] : null;
  }
  // bentConnector3: x1; 4: x1, y2; 5: x1, y2, x3.
  adjust.push(ratio(local[1].x, w));
  if (bends >= 3) adjust.push(ratio(local[2].y, h));
  if (bends === 4) adjust.push(ratio(local[3].x, w));
  if (adjust.some((value) => !Number.isFinite(value))) return null;
  return adjust.map((value) => Math.round(value));
}

/**
 * The stored geometry of a connector drawn through `points`: a straight
 * line for two points, otherwise a bent connector (or a curved one with the
 * same bends) whose turned and flipped path passes through every point.
 */
export function connectorGeometry(
  route: Point[],
  curved: boolean
): ConnectorGeometry {
  const points = simplify(route);
  const a = points[0];
  const b = points[points.length - 1];
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  if (points.length <= 2) {
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    return {
      prst: "straightConnector1",
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w,
      h,
      rotation: 0,
      flipH: b.x < a.x,
      flipV: b.y < a.y,
      adjust: [],
    };
  }

  const family = curved ? "curvedConnector" : "bentConnector";
  for (const rotation of [0, 90, 180, 270]) {
    for (const flipH of [false, true]) {
      for (const flipV of [false, true]) {
        const centered = points.map((p) =>
          toLocal(p, center, rotation, flipH, flipV)
        );
        const end = centered[centered.length - 1];
        // The path runs from the box's top left corner to its bottom right;
        // a side of 0 gets THIN, about the same center.
        if (end.x < -EPS || end.y < -EPS) continue;
        const w = Math.max(end.x * 2, THIN);
        const h = Math.max(end.y * 2, THIN);
        const local = centered.map((p, i) =>
          i === centered.length - 1
            ? { x: w, y: h }
            : i === 0
              ? { x: 0, y: 0 }
              : { x: p.x + w / 2, y: p.y + h / 2 }
        );
        const adjust = bentAdjust(local, w, h);
        if (!adjust) continue;
        return {
          prst: `${family}${points.length - 1}`,
          // The stored box is unturned: a quarter turn swaps its sides
          // about the same center.
          x: center.x - w / 2,
          y: center.y - h / 2,
          w,
          h,
          rotation,
          flipH,
          flipV,
          adjust,
        };
      }
    }
  }
  // An orthogonal route always fits one of the transforms; anything else is
  // drawn as a straight line between its ends.
  return connectorGeometry([a, b], false);
}
