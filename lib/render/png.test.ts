// Rasterizes with the real fonts (scripts/fetch-fonts.sh); CI fetches them
// before the tests.
import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import { backgroundDataUri, render, renderPng } from "./png";
import { renderSlideSvg } from "./svg";

const svg = () =>
  renderSlideSvg(sampleDocument().slides[0], {
    slideNumber: 1,
    background: backgroundDataUri(),
  });

function pixel(image: ReturnType<typeof render>, x: number, y: number) {
  const i = (y * image.width + x) * 4;
  const p = image.pixels;
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(p[i])}${hex(p[i + 1])}${hex(p[i + 2])}`;
}

/** Pixels in a region within `tolerance` of a color. */
function count(
  image: ReturnType<typeof render>,
  region: { x: number; y: number; w: number; h: number },
  match: (r: number, g: number, b: number) => boolean
) {
  // resvg copies the whole buffer on every read of `pixels`: read it once.
  const p = image.pixels;
  let n = 0;
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const i = (y * image.width + x) * 4;
      if (match(p[i], p[i + 1], p[i + 2])) n++;
    }
  }
  return n;
}

describe("renderPng", () => {
  it("returns a 1920 x 1080 PNG", () => {
    const png = renderPng(svg());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1920);
    expect(png.readUInt32BE(20)).toBe(1080);
  });

  it("paints shapes, the blue title and CJK text with the bundled fonts", () => {
    const image = render(svg());
    // Inside sh_capture, away from its text: its fill.
    expect(pixel(image, 180, 340)).toBe("#e8f1fe");
    // The title "System overview" in #3297fc inside the title box.
    const blue = count(
      image,
      { x: 178, y: 10, w: 1588, h: 138 },
      (r, g, b) =>
        Math.abs(r - 0x32) < 20 &&
        Math.abs(g - 0x97) < 20 &&
        Math.abs(b - 0xfc) < 20
    );
    expect(blue).toBeGreaterThan(2000);
    // 語音辨識 inside sh_asr: dark glyph pixels, which only a CJK font draws.
    const ink = count(
      image,
      { x: 1400, y: 380, w: 240, h: 80 },
      (r, g, b) => r < 80 && g < 80 && b < 80
    );
    expect(ink).toBeGreaterThan(1500);
  });
});
