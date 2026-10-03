// A zip reader for untrusted uploads. It reads the central directory itself
// and holds every entry to what it declares: entries may not overlap (one
// compressed run counted many times), a stored entry's size must match, and
// a deflated entry is inflated in small steps that stop the moment its
// output passes its declared size. Memory and CPU are then bounded by the
// declared sizes, which are capped before anything is read.
import { Inflate } from "fflate";

export type ZipLimits = {
  /** Entries, one entry's size, and all of them, uncompressed. */
  entries: number;
  entryBytes: number;
  totalBytes: number;
};

export class ZipError extends Error {
  constructor(
    readonly code: "not-zip" | "too-large" | "malformed",
    message: string
  ) {
    super(message);
  }
}

type Entry = {
  name: string;
  method: number;
  compressed: number;
  size: number;
  /** Where the entry's data starts in the file. */
  start: number;
};

const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const END = 0x06054b50;
/** Inflate input is fed in steps this size, so a bomb is stopped early. */
const STEP = 64 * 1024;

function findEnd(view: DataView): number {
  // The end record is 22 bytes plus a comment of up to 65,535.
  const last = view.byteLength - 22;
  for (let at = last; at >= Math.max(0, last - 65_535); at--) {
    if (view.getUint32(at, true) === END) return at;
  }
  throw new ZipError("not-zip", "no end of central directory");
}

function entries(bytes: Uint8Array, limits: ZipLimits): Entry[] {
  if (bytes.length < 22) throw new ZipError("not-zip", "too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(view);
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryAt = view.getUint32(end + 16, true);
  if (count === 0xffff || directoryAt === 0xffffffff) {
    throw new ZipError("malformed", "zip64 is not supported");
  }
  if (count > limits.entries)
    throw new ZipError("too-large", "too many entries");
  if (directoryAt + directorySize > end) {
    throw new ZipError("malformed", "central directory out of bounds");
  }

  const decoder = new TextDecoder();
  const out: Entry[] = [];
  let total = 0;
  let at = directoryAt;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL) {
      throw new ZipError("malformed", "bad central directory entry");
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (flags & 1) throw new ZipError("malformed", "encrypted entry");
    if (name.endsWith("/")) continue;
    if (method !== 0 && method !== 8) {
      throw new ZipError("malformed", `compression method ${method}`);
    }
    if (method === 0 && compressed !== size) {
      throw new ZipError("malformed", "stored entry with two sizes");
    }
    if (size > limits.entryBytes)
      throw new ZipError("too-large", "entry too large");
    total += size;
    if (total > limits.totalBytes)
      throw new ZipError("too-large", "too large in all");

    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL) {
      throw new ZipError("malformed", "bad local header");
    }
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    if (start + compressed > bytes.length) {
      throw new ZipError("malformed", "entry data out of bounds");
    }
    out.push({ name, method, compressed, size, start });
  }

  // Each byte of compressed data belongs to one entry at most.
  const sorted = [...out].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const before = sorted[i - 1];
    if (sorted[i].start < before.start + before.compressed) {
      throw new ZipError("malformed", "entries overlap");
    }
  }
  return out;
}

function inflate(data: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let length = 0;
  const stream = new Inflate((chunk) => {
    if (length + chunk.length > size) {
      throw new ZipError("malformed", "entry inflates past its size");
    }
    out.set(chunk, length);
    length += chunk.length;
  });
  for (let at = 0; at < data.length; at += STEP) {
    const next = Math.min(at + STEP, data.length);
    stream.push(data.subarray(at, next), next === data.length);
  }
  if (data.length === 0) stream.push(new Uint8Array(), true);
  if (length !== size)
    throw new ZipError("malformed", "entry shorter than its size");
  return out;
}

/**
 * The zip's files by name, each held to its declared size. `wanted` picks
 * the entries to read; the others are checked but never inflated.
 */
export function unzip(
  bytes: Uint8Array,
  limits: ZipLimits,
  wanted: (name: string) => boolean = () => true
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const entry of entries(bytes, limits)) {
    if (!wanted(entry.name) || files.has(entry.name)) continue;
    const data = bytes.subarray(entry.start, entry.start + entry.compressed);
    try {
      files.set(
        entry.name,
        entry.method === 0 ? data.slice() : inflate(data, entry.size)
      );
    } catch (error) {
      if (error instanceof ZipError) throw error;
      throw new ZipError("malformed", "invalid compressed data");
    }
  }
  return files;
}
