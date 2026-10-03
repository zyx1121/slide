// Drawing connectors and gluing their ends: which site a pointer snaps to,
// the connector a drag draws, and the patch that moves one of its ends.
// Pure functions, shared by the editor and its tests.
import type { Operation } from "../deck/patch";
import type { Shape, Slide } from "../deck/schema";
import { newId } from "../ids";
import { type Point, sitePoint } from "../render/connector";
import { containsPoint, tidy } from "./geometry";
import { DEFAULT_STROKE } from "./style";

type LineShape = Extract<Shape, { kind: "line" }>;
type BoxShape = Exclude<Shape, LineShape>;
export type End = LineShape["start"];
export type Side = "start" | "end";

const SITES = [0, 1, 2, 3];

/**
 * Where a connector end lands for a pointer at `p`: glued to the nearest
 * site of the shape under the pointer, or of any shape with a site within
 * `reach` px, else free at the point. `sites` are the snapping shape's four
 * sites, for the editor to draw.
 */
export type Snap = {
  end: End;
  point: Point;
  shape: string | null;
  sites: Point[];
};

export function snapEnd(
  slide: Slide,
  p: Point,
  reach: number,
  /** A shape the end may not glue to, such as the connector's other end's site. */
  avoid?: { shape: string; site: number }
): Snap {
  const boxes = slide.shapes.filter(
    (shape): shape is BoxShape => shape.kind !== "line"
  );
  const nearestSite = (shape: BoxShape) => {
    let best = { site: -1, distance: Infinity, point: p };
    for (const site of SITES) {
      if (avoid && avoid.shape === shape.id && avoid.site === site) continue;
      const { point } = sitePoint(shape, site);
      const distance = Math.hypot(point.x - p.x, point.y - p.y);
      if (distance < best.distance) best = { site, distance, point };
    }
    return best;
  };
  const glue = (shape: BoxShape, site: number, point: Point): Snap => ({
    end: { shape: shape.id, site },
    point,
    shape: shape.id,
    sites: SITES.map((s) => sitePoint(shape, s).point),
  });

  // A site within reach wins, the closest of all; then the shape under the
  // pointer, topmost first, glues at its nearest site.
  let close: {
    shape: BoxShape;
    site: number;
    distance: number;
    point: Point;
  } | null = null;
  for (const shape of boxes) {
    const best = nearestSite(shape);
    if (best.distance <= reach && (!close || best.distance < close.distance)) {
      close = { shape, ...best };
    }
  }
  if (close) return glue(close.shape, close.site, close.point);
  for (let i = boxes.length - 1; i >= 0; i--) {
    const shape = boxes[i];
    if (!containsPoint(shape, p)) continue;
    const best = nearestSite(shape);
    if (best.site >= 0) return glue(shape, best.site, best.point);
  }
  return {
    end: { x: tidy(p.x), y: tidy(p.y) },
    point: p,
    shape: null,
    sites: [],
  };
}

/** A new connector in WinLab's usual style: blue, with an arrowhead at its end. */
export function newLine(start: End, end: End): LineShape {
  return {
    id: newId("ln"),
    kind: "line",
    route: "straight",
    start,
    end,
    stroke: { ...DEFAULT_STROKE },
    endArrow: "triangle",
  };
}

/** The slide with one end of a connector moved, as a drag shows it. */
export function withLineEnd(
  slide: Slide,
  id: string,
  side: Side,
  end: End
): Slide {
  return {
    ...slide,
    shapes: slide.shapes.map((shape) =>
      shape.id === id && shape.kind === "line"
        ? { ...shape, [side]: end }
        : shape
    ),
  };
}

/** Moves one end of a connector; nothing when it lands where it was. */
export function lineEndOps(
  slide: Slide,
  slideIndex: number,
  id: string,
  side: Side,
  end: End
): Operation[] {
  const index = slide.shapes.findIndex((shape) => shape.id === id);
  const shape = slide.shapes[index];
  if (!shape || shape.kind !== "line") return [];
  if (JSON.stringify(shape[side]) === JSON.stringify(end)) return [];
  return [
    {
      op: "replace",
      path: `/slides/${slideIndex}/shapes/${index}/${side}`,
      value: end,
    },
  ];
}

/** The other end's glue, so a drag does not attach both ends to one site. */
export function otherGlue(
  line: LineShape,
  side: Side
): { shape: string; site: number } | undefined {
  const other = line[side === "start" ? "end" : "start"];
  return "shape" in other ? other : undefined;
}
