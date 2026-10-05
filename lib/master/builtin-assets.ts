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

type Builtins = {
  /** Pictures by sha256. */
  assets: Map<string, { mime: string; data: Buffer; pixels: number }>;
  /** Master files by sha256. */
  files: Map<string, Uint8Array>;
};

let builtins: Builtins | null = null;

function load(): Builtins {
  const assets: Builtins["assets"] = new Map();
  const files: Builtins["files"] = new Map();
  for (const name of BUILTIN_FILES) {
    const parts = unzipMasterParts(
      readFileSync(join(process.cwd(), "template", name))
    );
    const file = masterFile(parts);
    files.set(file.sha256, file.bytes);
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
  return { assets, files };
}

/** A built-in master's picture, or undefined. */
export function builtinAsset(sha256: string) {
  builtins ??= load();
  return builtins.assets.get(sha256);
}

/** A built-in master file by its sha256, or undefined. */
export function builtinMasterFile(sha256: string) {
  builtins ??= load();
  return builtins.files.get(sha256);
}
