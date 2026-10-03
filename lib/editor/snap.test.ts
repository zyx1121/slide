import { describe, expect, it } from "vitest";

import { snapRect } from "./snap";

const target = { x: 500, y: 200, w: 300, h: 100 };

describe("snapRect", () => {
  it("snaps an edge to another shape's edge and draws the guide across both", () => {
    const moving = { x: 503, y: 600, w: 200, h: 100 };
    const { dx, dy, guides } = snapRect(moving, [target], 6);
    expect(dx).toBe(-3);
    expect(dy).toBe(0);
    expect(guides).toEqual([{ axis: "x", at: 500, from: 200, to: 700 }]);
  });

  it("snaps centers, and to the slide's center lines", () => {
    // Centered at x = 955, five px left of the slide's center.
    const moving = { x: 905, y: 538, w: 100, h: 100 };
    const { dx, dy, guides } = snapRect(moving, [], 6);
    expect(dx).toBe(5);
    expect(dy).toBe(2);
    expect(guides).toContainEqual({ axis: "x", at: 960, from: 0, to: 1080 });
    expect(guides).toContainEqual({ axis: "y", at: 540, from: 0, to: 1920 });
  });

  it("leaves a rect alone when nothing is close", () => {
    const moving = { x: 20, y: 20, w: 100, h: 100 };
    expect(snapRect(moving, [target], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("snaps only the dragged edges during a resize", () => {
    // The left edge sits 2 px off the target's, but only the right edge may snap.
    const moving = { x: 502, y: 600, w: 295, h: 100 };
    const { dx } = snapRect(moving, [target], 6, { x: [1], y: [] });
    expect(dx).toBe(3);
  });
});
