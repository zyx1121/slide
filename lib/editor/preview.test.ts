import { describe, expect, it } from "vitest";

import { newImage } from "./preview";

describe("newImage", () => {
  it("places a picture at 1.5 canvas px per pixel, centered", () => {
    expect(
      newImage({ sha256: "a".repeat(64), width: 400, height: 300 })
    ).toMatchObject({
      kind: "image",
      w: 600,
      h: 450,
      x: 660,
      y: 315,
    });
  });

  it("shrinks a large picture to 80% of the slide, keeping its proportions", () => {
    const image = newImage({
      sha256: "a".repeat(64),
      width: 4000,
      height: 1000,
    });
    expect(image).toMatchObject({ w: 1536, h: 384 });
  });

  it("keeps a picture dropped near the edge on the slide", () => {
    const image = newImage(
      { sha256: "a".repeat(64), width: 200, height: 200 },
      { x: 1900, y: 10 }
    );
    expect(image).toMatchObject({ x: 1620, y: 0 });
  });
});
