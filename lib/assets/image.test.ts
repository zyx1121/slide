import { describe, expect, it } from "vitest";

import { sniffImage } from "./image";

/** A real 1 x 1 PNG. */
export const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  ),
  (ch) => ch.charCodeAt(0)
);

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    // APP0, 16 bytes
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    // SOF0: length 17, precision 8, height, width, 3 components
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);
}

describe("sniffImage", () => {
  it("reads a PNG's size", () => {
    expect(sniffImage(PNG_1X1)).toEqual({
      mime: "image/png",
      width: 1,
      height: 1,
    });
  });

  it("reads a JPEG's size from its frame header", () => {
    expect(sniffImage(jpeg(640, 480))).toEqual({
      mime: "image/jpeg",
      width: 640,
      height: 480,
    });
  });

  it("reads a GIF's size", () => {
    const gif = new TextEncoder().encode("GIF89a\x20\x03\x58\x02rest");
    expect(sniffImage(gif)).toEqual({
      mime: "image/gif",
      width: 800,
      height: 600,
    });
  });

  it("refuses SVG, WebP, text and cut-off files", () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    );
    const webp = new TextEncoder().encode(
      "RIFF\0\0\0\0WEBPVP8X" + "\0".repeat(20)
    );
    expect(sniffImage(svg)).toBeNull();
    expect(sniffImage(webp)).toBeNull();
    expect(sniffImage(new TextEncoder().encode("hello"))).toBeNull();
    expect(sniffImage(PNG_1X1.slice(0, 20))).toBeNull();
    expect(sniffImage(jpeg(0, 0))).toBeNull();
  });
});
