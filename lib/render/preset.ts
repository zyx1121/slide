// Outlines of PowerPoint's preset shapes beyond rectangles and ellipses, at
// their default adjustments, after presetShapeDefinitions.xml in ECMA-376.
import type { PresetGeometry } from "../deck/schema";

type Box = { x: number; y: number; w: number; h: number };

/** A filled outline, and for open shapes the stroked part when it differs. */
export type PresetPath = { fill: string; stroke?: string };

const n = (value: number) => String(Math.round(value * 100) / 100);
const polygon = (points: [number, number][]) =>
  `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}Z`;

/** The outline of a preset in its box. */
export function presetPath(geometry: PresetGeometry, box: Box): PresetPath {
  const { x: l, y: t, w, h } = box;
  const r = l + w;
  const b = t + h;
  const hc = l + w / 2;
  const vc = t + h / 2;
  // DrawingML sizes heads and insets on the shorter side.
  const ss = Math.min(w, h);
  // A head at the default 50%, never longer than the box allows.
  const head = (room: number) => Math.min(ss / 2, room);
  switch (geometry) {
    case "triangle":
      return {
        fill: polygon([
          [hc, t],
          [r, b],
          [l, b],
        ]),
      };
    case "rtTriangle":
      return {
        fill: polygon([
          [l, b],
          [l, t],
          [r, b],
        ]),
      };
    case "diamond":
      return {
        fill: polygon([
          [l, vc],
          [hc, t],
          [r, vc],
          [hc, b],
        ]),
      };
    case "parallelogram": {
      const x2 = Math.min(ss / 4, w);
      return {
        fill: polygon([
          [l, b],
          [l + x2, t],
          [r, t],
          [r - x2, b],
        ]),
      };
    }
    case "trapezoid": {
      const x2 = Math.min(ss / 4, w / 2);
      return {
        fill: polygon([
          [l, b],
          [l + x2, t],
          [r - x2, t],
          [r, b],
        ]),
      };
    }
    case "homePlate": {
      const x1 = r - head(w);
      return {
        fill: polygon([
          [l, t],
          [x1, t],
          [r, vc],
          [x1, b],
          [l, b],
        ]),
      };
    }
    case "chevron": {
      const dx = head(w);
      return {
        fill: polygon([
          [l, t],
          [r - dx, t],
          [r, vc],
          [r - dx, b],
          [l, b],
          [l + dx, vc],
        ]),
      };
    }
    case "rightArrow":
    case "leftArrow": {
      const dx = head(w);
      const y1 = vc - h / 4;
      const y2 = vc + h / 4;
      const points: [number, number][] = [
        [l, y1],
        [r - dx, y1],
        [r - dx, t],
        [r, vc],
        [r - dx, b],
        [r - dx, y2],
        [l, y2],
      ];
      // A left arrow is the right one mirrored about the box's center.
      return {
        fill: polygon(
          geometry === "rightArrow"
            ? points
            : points.map(([x, y]) => [l + r - x, y])
        ),
      };
    }
    case "downArrow":
    case "upArrow": {
      const dy = head(h);
      const x1 = hc - w / 4;
      const x2 = hc + w / 4;
      const points: [number, number][] = [
        [x1, t],
        [x2, t],
        [x2, b - dy],
        [r, b - dy],
        [hc, b],
        [l, b - dy],
        [x1, b - dy],
      ];
      return {
        fill: polygon(
          geometry === "downArrow"
            ? points
            : points.map(([x, y]) => [x, t + b - y])
        ),
      };
    }
    case "leftRightArrow": {
      const dx = head(w / 2);
      const y1 = vc - h / 4;
      const y2 = vc + h / 4;
      return {
        fill: polygon([
          [l, vc],
          [l + dx, t],
          [l + dx, y1],
          [r - dx, y1],
          [r - dx, t],
          [r, vc],
          [r - dx, b],
          [r - dx, y2],
          [l + dx, y2],
          [l + dx, b],
        ]),
      };
    }
    case "upDownArrow": {
      const dy = head(h / 2);
      const x1 = hc - w / 4;
      const x2 = hc + w / 4;
      return {
        fill: polygon([
          [l, t + dy],
          [hc, t],
          [r, t + dy],
          [x2, t + dy],
          [x2, b - dy],
          [r, b - dy],
          [hc, b],
          [l, b - dy],
          [x1, b - dy],
          [x1, t + dy],
        ]),
      };
    }
    case "bentArrow": {
      // A shaft up from the bottom left, bent right into a head, with the
      // guides of presetShapeDefinitions.xml at their defaults.
      const th = ss * 0.25;
      const aw2 = ss * 0.25;
      const dh2 = aw2 - th / 2;
      const ah = ss * 0.25;
      const bs = Math.min(w - ah, h - dh2);
      const bd = Math.min(ss * 0.4375, bs);
      const bd2 = Math.max(bd - th, 0);
      const x3 = l + th + bd2;
      const x4 = r - ah;
      const y3 = t + dh2 + th;
      const y4 = y3 + dh2;
      const y5 = t + dh2 + bd;
      const fill =
        `M${n(l)} ${n(b)}L${n(l)} ${n(y5)}` +
        `A${n(bd)} ${n(bd)} 0 0 1 ${n(l + bd)} ${n(t + dh2)}` +
        `L${n(x4)} ${n(t + dh2)}L${n(x4)} ${n(t)}L${n(r)} ${n(t + aw2)}` +
        `L${n(x4)} ${n(y4)}L${n(x4)} ${n(y3)}L${n(x3)} ${n(y3)}` +
        (bd2 > 0
          ? `A${n(bd2)} ${n(bd2)} 0 0 0 ${n(l + th)} ${n(y3 + bd2)}`
          : "") +
        `L${n(l + th)} ${n(b)}Z`;
      return { fill };
    }
    case "flowChartSummingJunction": {
      // A circle crossed by an X from corner to corner of its square.
      const rx = w / 2;
      const ry = h / 2;
      const ix = rx * Math.SQRT1_2;
      const iy = ry * Math.SQRT1_2;
      const circle = `M${n(l)} ${n(vc)}A${n(rx)} ${n(ry)} 0 1 1 ${n(r)} ${n(vc)}A${n(rx)} ${n(ry)} 0 1 1 ${n(l)} ${n(vc)}Z`;
      const cross = `M${n(hc - ix)} ${n(vc - iy)}L${n(hc + ix)} ${n(vc + iy)}M${n(hc + ix)} ${n(vc - iy)}L${n(hc - ix)} ${n(vc + iy)}`;
      return { fill: circle, stroke: circle + cross };
    }
    case "leftBracket":
    case "rightBracket": {
      // Corners round over 8.333% of the shorter side, as PowerPoint draws them.
      const dy = Math.min((ss * 8333) / 100000, h / 2);
      const stroke =
        geometry === "rightBracket"
          ? `M${n(l)} ${n(t)}A${n(w)} ${n(dy)} 0 0 1 ${n(r)} ${n(t + dy)}L${n(r)} ${n(b - dy)}A${n(w)} ${n(dy)} 0 0 1 ${n(l)} ${n(b)}`
          : `M${n(r)} ${n(b)}A${n(w)} ${n(dy)} 0 0 1 ${n(l)} ${n(b - dy)}L${n(l)} ${n(t + dy)}A${n(w)} ${n(dy)} 0 0 1 ${n(r)} ${n(t)}`;
      return { fill: `${stroke}Z`, stroke };
    }
  }
}
