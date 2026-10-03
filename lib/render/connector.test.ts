import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import type { Shape } from "../deck/schema";
import { elbowRoute, routeConnector, sitePoint } from "./connector";

const slide = sampleDocument().slides[0];
const shapes = new Map<string, Shape>(slide.shapes.map((s) => [s.id, s]));
const box = (id: string) => {
  const shape = shapes.get(id);
  if (!shape || shape.kind === "line") throw new Error(id);
  return shape;
};

const orthogonal = (points: { x: number; y: number }[]) =>
  points.slice(1).every((p, i) => p.x === points[i].x || p.y === points[i].y);

describe("sitePoint", () => {
  it("puts sites at the middle of the top, left, bottom and right sides", () => {
    const capture = box("sh_capture"); // x 160, y 320, w 480, h 200
    expect([0, 1, 2, 3].map((site) => sitePoint(capture, site))).toEqual([
      { point: { x: 400, y: 320 }, dir: "up" },
      { point: { x: 160, y: 420 }, dir: "left" },
      { point: { x: 400, y: 520 }, dir: "down" },
      { point: { x: 640, y: 420 }, dir: "right" },
    ]);
  });

  it("turns sites and their directions with the shape", () => {
    const turned = { ...box("sh_capture"), rotation: 90 };
    const right = sitePoint(turned, 3);
    expect(right.dir).toBe("down");
    expect(right.point.x).toBeCloseTo(400, 6);
    expect(right.point.y).toBeCloseTo(660, 6);
  });
});

describe("routes", () => {
  it("draws a straight connector between its two sites", () => {
    const line = shapes.get("ln_capture_asr")!;
    if (line.kind !== "line") throw new Error("fixture");
    expect(routeConnector(line, shapes)).toEqual({
      kind: "polyline",
      points: [
        { x: 640, y: 420 },
        { x: 1280, y: 420 },
      ],
    });
  });

  it("routes bottom to left as down then right, the case checked in PowerPoint", () => {
    const line = shapes.get("ln_capture_router")!;
    if (line.kind !== "line") throw new Error("fixture");
    // sh_capture bottom (400, 520) to sh_router left (1280, 820).
    expect(routeConnector(line, shapes)).toEqual({
      kind: "polyline",
      points: [
        { x: 400, y: 520 },
        { x: 400, y: 820 },
        { x: 1280, y: 820 },
      ],
    });
  });

  it("routes facing sides through the middle with two bends", () => {
    expect(
      elbowRoute({ x: 0, y: 0 }, "right", { x: 200, y: 100 }, "left")
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
  });

  it("goes around when the target is behind, staying orthogonal", () => {
    const behind = elbowRoute(
      { x: 200, y: 0 },
      "right",
      { x: 0, y: 100 },
      "left"
    );
    expect(orthogonal(behind)).toBe(true);
    expect(behind[1]).toEqual({ x: 230, y: 0 });
    expect(behind[behind.length - 2]).toEqual({ x: -30, y: 100 });
    const backward = elbowRoute(
      { x: 0, y: 0 },
      "down",
      { x: 200, y: -100 },
      "left"
    );
    expect(orthogonal(backward)).toBe(true);
    expect(backward[1]).toEqual({ x: 0, y: 30 });
  });

  it("loops out past the farther end when both leave the same side", () => {
    expect(
      elbowRoute({ x: 0, y: 0 }, "right", { x: 100, y: 200 }, "right")
    ).toEqual([
      { x: 0, y: 0 },
      { x: 130, y: 0 },
      { x: 130, y: 200 },
      { x: 100, y: 200 },
    ]);
  });

  it("bends a curved connector out of both sides", () => {
    const route = routeConnector(
      {
        id: "ln_curve",
        kind: "line",
        route: "curved",
        start: { shape: "sh_capture", site: 3 },
        end: { shape: "sh_asr", site: 1 },
        stroke: { color: "#000000", width: 2 },
      },
      shapes
    );
    expect(route.kind).toBe("curve");
    const [a, c1, c2, b] = route.points;
    expect(c1.x).toBeGreaterThan(a.x);
    expect(c2.x).toBeLessThan(b.x);
  });
});

describe("elbow routes between two boxes", () => {
  // Every pair of sites, for boxes beside, above, below, diagonal, nearly
  // aligned and 30 px apart, with the start box turned by quarter turns.
  const W = 200;
  const H = 120;
  const placements: [string, number, number][] = [
    ["right", 500, 0],
    ["left", -500, 0],
    ["below", 0, 350],
    ["above", 0, -350],
    ["right-below", 500, 350],
    ["right-above", 500, -350],
    ["left-below", -500, 350],
    ["left-above", -500, -350],
    ["right-slightly-below", 400, 60],
    ["left-slightly-below", -400, 60],
    ["below-slightly-right", 60, 250],
    ["above-slightly-left", -60, -250],
    ["near-right", 230, 20],
    ["near-below", 20, 150],
  ];
  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  type P = { x: number; y: number };
  const unit = (a: P, b: P) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  const inside = (p: P, r: { x: number; y: number; w: number; h: number }) =>
    p.x > r.x + 1 &&
    p.x < r.x + r.w - 1 &&
    p.y > r.y + 1 &&
    p.y < r.y + r.h - 1;

  it("leave and enter outward, stay orthogonal, and never cut through either box", () => {
    const failures: string[] = [];
    for (const rotation of [0, 90, 180, 270]) {
      for (const [name, dx, dy] of placements) {
        for (let s0 = 0; s0 < 4; s0++) {
          for (let s1 = 0; s1 < 4; s1++) {
            const a = {
              id: "sh_a1",
              kind: "rect" as const,
              x: 800,
              y: 400,
              w: W,
              h: H,
              rotation,
            };
            const b = {
              id: "sh_b1",
              kind: "rect" as const,
              x: 800 + dx,
              y: 400 + dy,
              w: W,
              h: H,
              rotation: 0,
            };
            const shapes = new Map<string, Shape>([
              [a.id, a],
              [b.id, b],
            ]);
            const boxes = [a, b].map((r) =>
              r.rotation % 180 === 0
                ? r
                : {
                    x: r.x + (r.w - r.h) / 2,
                    y: r.y + (r.h - r.w) / 2,
                    w: r.h,
                    h: r.w,
                  }
            );
            const [ra, rb] = boxes;
            // Overlapping boxes cannot be joined without crossing one.
            if (
              ra.x < rb.x + rb.w &&
              rb.x < ra.x + ra.w &&
              ra.y < rb.y + rb.h &&
              rb.y < ra.y + ra.h
            ) {
              continue;
            }
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
            const pts = route.points as P[];
            const sa = sitePoint(a, s0);
            const sb = sitePoint(b, s1);
            const label = `rot ${rotation} ${name} ${s0}->${s1}`;
            const near = (p: P, q: P) =>
              Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
            if (!near(pts[0], sa.point) || !near(pts[pts.length - 1], sb.point))
              failures.push(`${label}: ends`);
            for (let i = 1; i < pts.length; i++) {
              if (
                Math.abs(pts[i].x - pts[i - 1].x) > 1e-6 &&
                Math.abs(pts[i].y - pts[i - 1].y) > 1e-6
              )
                failures.push(`${label}: diagonal`);
            }
            const out = unit(pts[0], pts[1]);
            if (out.x * DIRS[sa.dir].x + out.y * DIRS[sa.dir].y < 0.99)
              failures.push(`${label}: exits inward`);
            const into = unit(pts[pts.length - 2], pts[pts.length - 1]);
            if (-(into.x * DIRS[sb.dir].x + into.y * DIRS[sb.dir].y) < 0.99)
              failures.push(`${label}: enters from inside`);
            for (let i = 2; i < pts.length; i++) {
              const u = unit(pts[i - 2], pts[i - 1]);
              const v = unit(pts[i - 1], pts[i]);
              if (u.x * v.x + u.y * v.y < -0.99)
                failures.push(`${label}: doubles back`);
            }
            for (let i = 1; i < pts.length; i++) {
              for (let t = 0.02; t < 1; t += 0.02) {
                const p = {
                  x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
                  y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
                };
                if (boxes.some((r) => inside(p, r))) {
                  failures.push(`${label}: through a box`);
                  break;
                }
              }
            }
          }
        }
      }
    }
    expect([...new Set(failures)]).toEqual([]);
  });
});

describe("elbow routes between boxes close together", () => {
  const box = (id: string, x: number, y: number) => ({
    id,
    kind: "rect" as const,
    x,
    y,
    w: 200,
    h: 120,
  });
  const route = (
    a: ReturnType<typeof box>,
    s0: number,
    b: ReturnType<typeof box>,
    s1: number
  ) =>
    routeConnector(
      {
        id: "ln_close",
        kind: "line",
        route: "elbow",
        start: { shape: a.id, site: s0 },
        end: { shape: b.id, site: s1 },
        stroke: { color: "#000000", width: 2 },
      },
      new Map<string, Shape>([
        [a.id, a],
        [b.id, b],
      ])
    ).points;

  it("draws a straight line between facing sides 40, 20 and 10 px apart", () => {
    for (const gap of [40, 20, 10]) {
      const a = box("sh_a1", 100, 100);
      const b = box("sh_b1", 300 + gap, 100);
      expect(route(a, 3, b, 1)).toHaveLength(2);
      const c = box("sh_c1", 100, 220 + gap);
      expect(route(a, 2, c, 0)).toHaveLength(2);
    }
  });

  it("uses one Z between facing sides that are offset", () => {
    const a = box("sh_a1", 100, 100);
    const b = box("sh_b1", 340, 110);
    expect(route(a, 3, b, 1).length - 2).toBeLessThanOrEqual(2);
  });

  it("bends once when the corner is 10 or 20 px ahead", () => {
    for (const ahead of [10, 20]) {
      const a = box("sh_a1", 100, 100);
      // a's bottom site is (200, 220); b's left site sits `ahead` px below it.
      const b = box("sh_b1", 400, 220 + ahead - 60);
      expect(route(a, 2, b, 1)).toEqual([
        { x: 200, y: 220 },
        { x: 200, y: 220 + ahead },
        { x: 400, y: 220 + ahead },
      ]);
    }
  });
});
