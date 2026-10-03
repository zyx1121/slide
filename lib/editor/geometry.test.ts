import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import type { Slide } from "../deck/schema";
import {
  type BoxShape,
  containsPoint,
  handlePoint,
  hitTest,
  MIN_SIZE,
  resizeBox,
  shapesInRect,
} from "./geometry";

const rect = (extra: Partial<BoxShape> = {}): BoxShape =>
  ({
    id: "sh_a1",
    kind: "rect",
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    ...extra,
  }) as BoxShape;

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("containsPoint", () => {
  it("follows a turned box, not its unturned frame", () => {
    const turned = rect({ rotation: 90 });
    // Turned a quarter, the 200 x 100 box spans x 50 to 150, y -50 to 150.
    expect(containsPoint(turned, { x: 100, y: 140 })).toBe(true);
    expect(containsPoint(turned, { x: 20, y: 50 })).toBe(false);
    expect(containsPoint(rect(), { x: 20, y: 50 })).toBe(true);
  });

  it("leaves out an ellipse's corners", () => {
    const ellipse = rect({ kind: "ellipse" } as Partial<BoxShape>);
    expect(containsPoint(ellipse, { x: 100, y: 50 })).toBe(true);
    expect(containsPoint(ellipse, { x: 5, y: 5 })).toBe(false);
  });
});

describe("hitTest", () => {
  const slide = sampleDocument().slides[0];

  it("picks the topmost shape under the point", () => {
    const stacked: Slide = {
      ...slide,
      shapes: [
        rect({ id: "sh_below" }),
        rect({ id: "sh_above", x: 100, y: 50 }),
      ],
    };
    expect(hitTest(stacked, { x: 150, y: 75 }, 4)).toBe("sh_above");
    expect(hitTest(stacked, { x: 50, y: 25 }, 4)).toBe("sh_below");
    expect(hitTest(stacked, { x: 500, y: 500 }, 4)).toBeNull();
  });

  it("looks through a hollow frame to the shapes inside it", () => {
    const framed: Slide = {
      ...slide,
      shapes: [
        rect({
          id: "sh_inside",
          x: 100,
          y: 100,
          w: 100,
          h: 50,
          fill: "#ffffff",
        }),
        rect({
          id: "sh_frame",
          x: 50,
          y: 50,
          w: 400,
          h: 300,
          stroke: { color: "#3297fc", width: 4 },
        }),
      ],
    };
    // Inside the frame, over the filled box: the box.
    expect(hitTest(framed, { x: 150, y: 125 }, 4)).toBe("sh_inside");
    // Inside the frame over nothing else: the frame. On its edge: the frame.
    expect(hitTest(framed, { x: 300, y: 250 }, 4)).toBe("sh_frame");
    expect(hitTest(framed, { x: 52, y: 125 }, 4)).toBe("sh_frame");
    // A frame with words, or with a fill, is picked anywhere inside.
    const worded: Slide = {
      ...framed,
      shapes: [
        framed.shapes[0],
        {
          ...framed.shapes[1],
          text: { paragraphs: [{ runs: [{ text: "Hearing" }] }] },
        } as BoxShape,
      ],
    };
    expect(hitTest(worded, { x: 150, y: 125 }, 4)).toBe("sh_frame");
  });

  it("picks a box with no height near where it is drawn", () => {
    const flat: Slide = {
      ...slide,
      shapes: [rect({ id: "sh_flat", x: 100, y: 100, w: 300, h: 0 })],
    };
    expect(hitTest(flat, { x: 200, y: 101 }, 4)).toBe("sh_flat");
    expect(hitTest(flat, { x: 200, y: 110 }, 4)).toBeNull();
  });

  it("picks a connector near its line", () => {
    // ln_capture_asr runs straight at y = 420 from x = 640 to x = 1280.
    expect(hitTest(slide, { x: 960, y: 425 }, 4)).toBe("ln_capture_asr");
    expect(hitTest(slide, { x: 960, y: 440 }, 4)).toBeNull();
  });
});

describe("shapesInRect", () => {
  it("selects shapes the marquee holds entirely", () => {
    const slide = sampleDocument().slides[0];
    const picked = shapesInRect(slide, { x: 100, y: 300, w: 600, h: 260 });
    expect(picked).toEqual(["sh_capture"]);
    const wide = shapesInRect(slide, { x: 100, y: 300, w: 1700, h: 260 });
    expect(wide).toEqual(["sh_capture", "sh_asr", "ln_capture_asr"]);
  });
});

describe("resizeBox", () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };

  it("keeps the opposite edge or corner where it is", () => {
    expect(resizeBox(box, "e", { x: 30, y: 99 })).toEqual({
      x: 100,
      y: 100,
      w: 230,
      h: 100,
    });
    expect(resizeBox(box, "w", { x: -30, y: 0 })).toEqual({
      x: 70,
      y: 100,
      w: 230,
      h: 100,
    });
    expect(resizeBox(box, "nw", { x: 20, y: 10 })).toEqual({
      x: 120,
      y: 110,
      w: 180,
      h: 90,
    });
    expect(resizeBox(box, "s", { x: 0, y: 50 })).toEqual({
      x: 100,
      y: 100,
      w: 200,
      h: 150,
    });
  });

  it("stops at the minimum size instead of flipping", () => {
    const shrunk = resizeBox(box, "e", { x: -500, y: 0 });
    expect(shrunk).toEqual({ x: 100, y: 100, w: MIN_SIZE, h: 100 });
  });

  it("keeps the aspect ratio with Shift", () => {
    expect(resizeBox(box, "se", { x: 100, y: 0 }, true)).toEqual({
      x: 100,
      y: 100,
      w: 300,
      h: 150,
    });
    // An edge handle grows the box evenly about its center line.
    expect(resizeBox(box, "e", { x: 200, y: 0 }, true)).toEqual({
      x: 100,
      y: 50,
      w: 400,
      h: 200,
    });
  });

  it("resizes a turned box along its own axes", () => {
    const turned = { ...box, rotation: 90 };
    // Turned a quarter, the box's "e" handle points down the canvas.
    const anchor = handlePoint(turned, "w");
    const after = resizeBox(turned, "e", { x: 0, y: 40 });
    expect(after.w).toBeCloseTo(240, 6);
    expect(after.h).toBeCloseTo(100, 6);
    close(handlePoint(after, "w"), anchor);
  });
});
