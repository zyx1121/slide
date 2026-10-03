// Rasterizes with the real fonts (scripts/fetch-fonts.sh); CI fetches them
// before the tests.
import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import {
  backgroundDataUri,
  render,
  RenderBusyError,
  renderPng,
  renderPngAsync,
} from "./png";
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

  it("shows only the cropped part of a picture, stretched over its box", () => {
    // A picture red on its left half and blue on its right.
    const picture = `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="100" height="100" fill="#ff0000"/><rect x="100" width="100" height="100" fill="#0000ff"/></svg>'
    ).toString("base64")}`;
    const slide = {
      id: "sl_crop",
      title: "",
      shapes: [
        {
          id: "im_crop",
          kind: "image" as const,
          x: 400,
          y: 400,
          w: 400,
          h: 200,
          asset: "a".repeat(64),
          crop: { left: 0, top: 0, right: 0.5, bottom: 0 },
        },
      ],
    };
    const image = render(
      renderSlideSvg(slide, {
        slideNumber: 1,
        background: null,
        assetHref: () => picture,
      })
    );
    const box = { x: 405, y: 405, w: 390, h: 190 };
    const red = count(image, box, (r, g, b) => r > 200 && g < 50 && b < 50);
    expect(red).toBe(box.w * box.h);
    // Nothing spills past the box.
    expect(pixel(image, 820, 500)).not.toBe("#0000ff");
    // Padded a quarter on each side: the picture's middle half of the box.
    const padded = render(
      renderSlideSvg(
        {
          ...slide,
          shapes: [
            {
              ...slide.shapes[0],
              crop: { left: -0.5, top: 0, right: -0.5, bottom: 0 },
            },
          ],
        },
        { slideNumber: 1, background: null, assetHref: () => picture }
      )
    );
    expect(pixel(padded, 410, 500)).not.toBe("#ff0000");
    expect(pixel(padded, 550, 500)).toBe("#ff0000");
    expect(pixel(padded, 650, 500)).toBe("#0000ff");
    expect(pixel(padded, 790, 500)).not.toBe("#0000ff");
  });

  it("draws bold CJK with Noto Sans TC Bold, heavier than regular", () => {
    const ink = (bold: boolean) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120" width="400" height="120"><text x="10" y="90" font-size="80" font-family="Noto Sans TC"${bold ? ' font-weight="700"' : ""}>第二點</text></svg>`;
      return count(
        render(svg, 400),
        { x: 0, y: 0, w: 400, h: 120 },
        (r, g, b) => r < 100 && g < 100 && b < 100
      );
    };
    expect(ink(true)).toBeGreaterThan(ink(false) * 1.3);
  });

  it("renders text that carried control characters", () => {
    const slide = {
      id: "sl_ctrl",
      title: "Title\u000bwith a break\u0001",
      shapes: [],
    };
    expect(() =>
      renderPng(renderSlideSvg(slide, { slideNumber: 3, background: null }))
    ).not.toThrow();
  });
});

describe("renderPngAsync", () => {
  it("renders off the request thread", async () => {
    const png = await renderPngAsync(svg(), 480);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("gives up on a render past its time limit", async () => {
    // A heavy slide: a lot of text, a millisecond to draw it in.
    const heavy = renderSlideSvg(
      {
        id: "sl_heavy",
        title: "",
        shapes: Array.from({ length: 4 }, (_, i) => ({
          id: `tx_heavy${i}`,
          kind: "text" as const,
          x: 0,
          y: 0,
          w: 1900,
          h: 1000,
          text: { paragraphs: [{ runs: [{ text: "word ".repeat(1000) }] }] },
        })),
      },
      { slideNumber: 1, background: null }
    );
    const failed = await renderPngAsync(heavy, 1920, {
      running: 2,
      waiting: 8,
      timeoutMs: 1,
    }).catch((error: RenderBusyError) => error);
    expect(failed).toBeInstanceOf(RenderBusyError);
    expect((failed as RenderBusyError).reason).toBe("timeout");
  });

  it("turns away a render when too many wait", async () => {
    const limits = { running: 1, waiting: 0, timeoutMs: 10_000 };
    const first = renderPngAsync(svg(), 480, limits);
    const second = await renderPngAsync(svg(), 480, limits).catch(
      (error: RenderBusyError) => error
    );
    expect(second).toBeInstanceOf(RenderBusyError);
    expect((second as RenderBusyError).reason).toBe("busy");
    await first;
    // The slot is free again.
    await expect(renderPngAsync(svg(), 480, limits)).resolves.toBeInstanceOf(
      Buffer
    );
  });
});
