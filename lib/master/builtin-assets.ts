// Server only: what the built-in masters (template/*.pptx) hold, read once.
// Their pictures are assets anyone may draw (the masters ship with Slide),
// and their master files are what an export of a deck on them starts from.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sniffImage } from "../assets/image";
import { masterFile } from "../pptx/master-file";
import { unzipMasterParts } from "../pptx/read";

export const BUILTIN_FILES = ["plain.pptx", "winlab.pptx"] as const;

/**
 * Master files the built-ins had before, by sha256, and the template each
 * was cut from. A change to how master files are cut changes their sha256;
 * decks (and their history) keep the old one, so it is listed here.
 */
export const RETIRED_FILES: Record<string, (typeof BUILTIN_FILES)[number]> = {
  // Before #153: presentation.xml kept all but a few of its children.
  a4f8bb3277f93e01c22d7d3dd13c48e18f4c6e25cf08d4336b89065f4169697c:
    "plain.pptx",
  "730171b0c26eda7b35f423d467e891c01248de3c98606935939356114eca605f":
    "winlab.pptx",
};

type Builtins = {
  /** Pictures by sha256. */
  assets: Map<string, { mime: string; data: Buffer; pixels: number }>;
  /** Master files by sha256. */
  files: Map<string, Uint8Array>;
  /** The current master file of each template. */
  byTemplate: Map<string, Uint8Array>;
};

let builtins: Builtins | null = null;

function load(): Builtins {
  const assets: Builtins["assets"] = new Map();
  const files: Builtins["files"] = new Map();
  const byTemplate: Builtins["byTemplate"] = new Map();
  for (const name of BUILTIN_FILES) {
    const parts = unzipMasterParts(
      readFileSync(join(process.cwd(), "template", name))
    );
    const file = masterFile(parts);
    files.set(file.sha256, file.bytes);
    byTemplate.set(name, file.bytes);
    for (const [part, bytes] of parts) {
      if (!part.startsWith("ppt/media/")) continue;
      // Pictures the editor draws; others (EMF, say) are left out.
      const info = sniffImage(bytes);
      if (!info) continue;
      assets.set(createHash("sha256").update(bytes).digest("hex"), {
        mime: info.mime,
        data: Buffer.from(bytes),
        pixels: info.width * info.height,
      });
    }
  }
  return { assets, files, byTemplate };
}

/** A built-in master's picture, or undefined. */
export function builtinAsset(sha256: string) {
  builtins ??= load();
  return builtins.assets.get(sha256);
}

/**
 * A built-in master file by its sha256, or undefined: the current one, or
 * the current file of the template a retired sha256 was cut from.
 */
export function builtinMasterFile(sha256: string) {
  builtins ??= load();
  const retired = Object.hasOwn(RETIRED_FILES, sha256)
    ? RETIRED_FILES[sha256]
    : undefined;
  return (
    builtins.files.get(sha256) ??
    (retired ? builtins.byTemplate.get(retired) : undefined)
  );
}
