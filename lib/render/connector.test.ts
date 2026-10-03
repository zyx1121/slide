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
