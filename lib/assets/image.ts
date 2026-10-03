// What an uploaded file is, read from its own bytes rather than from the
// name or type the browser sends: PNG, JPEG or GIF, and its size in pixels.
// Anything else is refused: SVG can carry script, and WebP is neither drawn
// by the server's renderer (resvg) nor opened by older PowerPoint.

export type ImageInfo = {
  mime: "image/png" | "image/jpeg" | "image/gif";
  width: number;
  height: number;
};

const ascii = (bytes: Uint8Array, at: number, text: string) =>
  [...text].every((ch, i) => bytes[at + i] === ch.charCodeAt(0));
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32be = (b: Uint8Array, at: number) =>
  ((b[at] << 24) >>> 0) + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);

function png(b: Uint8Array): ImageInfo | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !signature.every((v, i) => b[i] === v)) return null;
  if (!ascii(b, 12, "IHDR")) return null;
  return { mime: "image/png", width: u32be(b, 16), height: u32be(b, 20) };
}

function gif(b: Uint8Array): ImageInfo | null {
  if (b.length < 10 || !(ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a"))) {
    return null;
  }
  return { mime: "image/gif", width: u16le(b, 6), height: u16le(b, 8) };
}

/** JPEG: the size is in the first start-of-frame segment. */
function jpeg(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = u16be(b, at + 2);
    if (length < 2) return null;
    const frame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (frame) {
      return {
        mime: "image/jpeg",
        height: u16be(b, at + 5),
        width: u16be(b, at + 7),
      };
    }
    at += 2 + length;
  }
  return null;
}

/** The image a file holds, or null when it is not one we accept. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const info = png(bytes) ?? jpeg(bytes) ?? gif(bytes);
  if (!info || info.width <= 0 || info.height <= 0) return null;
  return info;
}
