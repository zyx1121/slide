// Snapping while shapes move or resize: to other shapes' edges and centers
// and to the slide's center lines, as PowerPoint's smart guides do.
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "../deck/schema";
import type { Rect } from "./geometry";

/**
 * A guide line to draw: on axis "x" a vertical line at x = `at` from y =
 * `from` to `to`; on axis "y" a horizontal one.
 */
export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

/** Which of a rect's lines may snap, as fractions of its width and height. */
export type Edges = { x: number[]; y: number[] };

/** All three lines per axis: for a move. */
export const ALL_EDGES: Edges = { x: [0, 0.5, 1], y: [0, 0.5, 1] };

type Candidate = { at: number; from: number; to: number };

function candidates(targets: Rect[]): { x: Candidate[]; y: Candidate[] } {
  const x: Candidate[] = [{ at: SLIDE_WIDTH / 2, from: 0, to: SLIDE_HEIGHT }];
  const y: Candidate[] = [{ at: SLIDE_HEIGHT / 2, from: 0, to: SLIDE_WIDTH }];
  for (const r of targets) {
    for (const f of [0, 0.5, 1]) {
      x.push({ at: r.x + f * r.w, from: r.y, to: r.y + r.h });
      y.push({ at: r.y + f * r.h, from: r.x, to: r.x + r.w });
    }
  }
  return { x, y };
}

/** The smallest offset within `threshold` that puts a value on a candidate. */
function nearest(
  values: number[],
  lines: Candidate[],
  threshold: number
): number | null {
  let best: number | null = null;
  for (const v of values) {
    for (const line of lines) {
      const d = line.at - v;
      if (
        Math.abs(d) <= threshold &&
        (best === null || Math.abs(d) < Math.abs(best))
      ) {
        best = d;
      }
    }
  }
  return best;
}

/** Guides along the lines a snapped rect now sits on, merged per line. */
function guidesFor(
  axis: "x" | "y",
  values: number[],
  span: [number, number],
  lines: Candidate[]
): Guide[] {
  const merged = new Map<number, Guide>();
  for (const line of lines) {
    if (!values.some((v) => Math.abs(v - line.at) < 0.5)) continue;
    const key = Math.round(line.at * 100);
    const guide = merged.get(key) ?? {
      axis,
      at: line.at,
      from: span[0],
      to: span[1],
    };
    guide.from = Math.min(guide.from, line.from);
    guide.to = Math.max(guide.to, line.to);
    merged.set(key, guide);
  }
  return [...merged.values()];
}

/**
 * Snaps a moving rect to the edges and centers of `targets` and to the
 * slide's center lines. Returns the offset to add on each axis (0 where
 * nothing is within `threshold` px) and the guides to draw. `edges` limits
 * which of the rect's lines may snap: all three for a move, the dragged
 * edges for a resize.
 */
export function snapRect(
  moving: Rect,
  targets: Rect[],
  threshold: number,
  edges: Edges = ALL_EDGES
): { dx: number; dy: number; guides: Guide[] } {
  const lines = candidates(targets);
  const xs = edges.x.map((f) => moving.x + f * moving.w);
  const ys = edges.y.map((f) => moving.y + f * moving.h);
  const dx = nearest(xs, lines.x, threshold);
  const dy = nearest(ys, lines.y, threshold);
  const guides: Guide[] = [];
  const top = moving.y + (dy ?? 0);
  const left = moving.x + (dx ?? 0);
  if (dx !== null) {
    guides.push(
      ...guidesFor(
        "x",
        xs.map((v) => v + dx),
        [top, top + moving.h],
        lines.x
      )
    );
  }
  if (dy !== null) {
    guides.push(
      ...guidesFor(
        "y",
        ys.map((v) => v + dy),
        [left, left + moving.w],
        lines.y
      )
    );
  }
  return { dx: dx ?? 0, dy: dy ?? 0, guides };
}
