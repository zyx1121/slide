// Server only: the built-in masters (template/*.pptx) as the deck document
// holds them. scripts/masters.ts writes them to builtin.json; a test checks
// the file still matches.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { inspectAsset } from "../assets/store";
import type { Master } from "../deck/schema";
import { PALETTE } from "../editor/palette";
import { importPptx } from "../pptx/import";
import type { BuiltinId } from "./layout";

async function read(
  file: string,
  name: string,
  /** The layout new slides take, by name. */
  layoutName: string,
  palette?: string[]
) {
  const result = await importPptx(
    readFileSync(join(process.cwd(), "template", file)),
    async (bytes) => {
      try {
        return { sha256: inspectAsset(bytes).sha256 };
      } catch {
        return null;
      }
    }
  );
  const { master } = result.document;
  // Stable ids, so the file only changes when a template does.
  const groups = [
    { shapes: master.shapes, prefix: "ar_m" },
    ...master.layouts.map((layout, l) => ({
      shapes: layout.shapes,
      prefix: `ar_${l}`,
    })),
  ];
  groups.forEach(({ shapes, prefix }) => {
    const ids = new Map(shapes.map((shape, i) => [shape.id, `${prefix}_${i}`]));
    for (const shape of shapes) {
      shape.id = ids.get(shape.id)!;
      if (shape.kind !== "line") continue;
      for (const end of [shape.start, shape.end]) {
        if ("shape" in end) end.shape = ids.get(end.shape) ?? end.shape;
      }
    }
  });
  const layout = master.layouts.findIndex((l) => l.name === layoutName);
  if (layout === -1) throw new Error(`${file} has no layout ${layoutName}`);
  return { ...master, name, layout, ...(palette ? { palette } : {}) };
}

/** The built-in masters, read from their files. */
export async function readBuiltinMasters(): Promise<Record<BuiltinId, Master>> {
  return {
    plain: await read("plain.pptx", "空白", "Title & Bullets"),
    winlab: await read(
      "winlab.pptx",
      "WinLab",
      "Title & Bullets",
      PALETTE.map((color) => color.value)
    ),
  };
}
