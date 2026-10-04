import { describe, expect, it } from "vitest";

import type { Shape } from "../deck/schema";
import { routeConnector } from "../render/connector";
import type { Point } from "../render/connector";
import { type ConnectorGeometry, connectorGeometry } from "./connector";

type P = { x: number; y: number };

/**
 * The path a bent connector draws: the preset's points in its
 * box, flipped and turned onto the slide.
 */
function drawnPath(geometry: ConnectorGeometry): Point[] {
  const { w, h, adjust } = geometry;
  const bends = Number(geometry.prst.slice(-1)) - 1;
  const local: Point[] =
    geometry.prst === "straightConnector1"
      ? [
          { x: 0, y: 0 },
          { x: w, y: h },
        ]
      : bends === 1
        ? [
            { x: 0, y: 0 },
            { x: w, y: 0 },
            { x: w, y: h },
          ]
        : bends === 2
          ? [
              { x: 0, y: 0 },
              { x: (w * adjust[0]) / 1e5, y: 0 },
              { x: (w * adjust[0]) / 1e5, y: h },
              { x: w, y: h },
            ]
          : bends === 3
            ? [
                { x: 0, y: 0 },
                { x: (w * adjust[0]) / 1e5, y: 0 },
                { x: (w * adjust[0]) / 1e5, y: (h * adjust[1]) / 1e5 },
                { x: w, y: (h * adjust[1]) / 1e5 },
                { x: w, y: h },
              ]
            : [
                { x: 0, y: 0 },
                { x: (w * adjust[0]) / 1e5, y: 0 },
                { x: (w * adjust[0]) / 1e5, y: (h * adjust[1]) / 1e5 },
                { x: (w * adjust[2]) / 1e5, y: (h * adjust[1]) / 1e5 },
                { x: (w * adjust[2]) / 1e5, y: h },
                { x: w, y: h },
              ];
  const cx = geometry.x + w / 2;
  const cy = geometry.y + h / 2;
  const r = (geometry.rotation * Math.PI) / 180;
  return local.map((p) => {
    let x = p.x - w / 2;
    let y = p.y - h / 2;
    if (geometry.flipH) x = -x;
    if (geometry.flipV) y = -y;
    return {
      x: cx + x * Math.cos(r) - y * Math.sin(r),
      y: cy + x * Math.sin(r) + y * Math.cos(r),
    };
  });
}

/** The route without repeated points or straight runs split in two. */
function corners(points: P[]): P[] {
  const out: P[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6)
      continue;
    const before = out.at(-2);
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

const placements: [string, number, number][] = [
  ["right", 500, 0],
  ["left", -500, 0],
  ["below", 0, 350],
  ["above", 0, -350],
  ["below right", 450, 300],
  ["above left", -450, -300],
  ["below left", -450, 300],
  ["above right", 450, -300],
];

describe("connectorGeometry", () => {
  it("stores every elbow route so PowerPoint draws the same path", () => {
    const failures: string[] = [];
    let checked = 0;
    for (const rotation of [0, 90]) {
      for (const [name, dx, dy] of placements) {
        for (let s0 = 0; s0 < 4; s0++) {
          for (let s1 = 0; s1 < 4; s1++) {
            const a: Shape = {
              id: "sh_a1",
              kind: "rect",
              x: 800,
              y: 400,
              w: 240,
              h: 120,
              rotation,
            };
            const b: Shape = {
              id: "sh_b1",
              kind: "rect",
              x: 800 + dx,
              y: 400 + dy,
              w: 240,
              h: 120,
            };
            const shapes = new Map<string, Shape>([
              [a.id, a],
              [b.id, b],
            ]);
            const route = routeConnector(
              {
                id: "ln_x1",
                kind: "line",
                route: "elbow",
                start: { shape: a.id, site: s0 },
                end: { shape: b.id, site: s1 },
                stroke: { color: "#000000", width: 2 },
              },
              shapes
            );
            const want = corners(route.points);
            const geometry = connectorGeometry(route.points, false);
            const got = drawnPath(geometry);
            checked++;
            const label = `rot ${rotation} ${name} ${s0}->${s1} ${geometry.prst}`;
            if (got.length !== want.length) {
              failures.push(
                `${label}: ${got.length} points, want ${want.length}`
              );
              continue;
            }
            got.forEach((p, i) => {
              // A level path's box is 0.5 px thin, so its ends move 0.25 px.
              if (Math.hypot(p.x - want[i].x, p.y - want[i].y) > 0.3)
                failures.push(`${label}: point ${i}`);
            });
          }
        }
      }
    }
    expect(checked).toBe(256);
    expect(failures).toEqual([]);
  });

  it("uses the preset with as many bends as the route", () => {
    const one = connectorGeometry(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 300, y: 100 },
      ],
      false
    );
    expect(one.prst).toBe("bentConnector2");
    // Down then right, as checked in PowerPoint: the preset turned and flipped.
    expect(
      drawnPath(one).map((p) => [Math.round(p.x), Math.round(p.y)])
    ).toEqual([
      [0, 0],
      [0, 100],
      [300, 100],
    ]);
    expect(
      connectorGeometry(
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 80 },
          { x: 200, y: 80 },
        ],
        true
      ).prst
    ).toBe("curvedConnector3");
  });

  it("stores a straight line with flips for its direction", () => {
    expect(
      connectorGeometry(
        [
          { x: 300, y: 50 },
          { x: 100, y: 250 },
        ],
        false
      )
    ).toMatchObject({
      prst: "straightConnector1",
      x: 100,
      y: 50,
      w: 200,
      h: 200,
      flipH: true,
      flipV: false,
    });
  });
});
