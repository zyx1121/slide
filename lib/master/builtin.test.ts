import { describe, expect, it } from "vitest";

import { builtinAsset, builtinMasterFile } from "./builtin-assets";
import { readBuiltinMasters } from "./build";
import { BUILTIN_MASTERS, layoutOf } from "./layout";

describe("built-in masters", () => {
  it("match their files (run bun scripts/masters.ts after changing one)", async () => {
    expect(await readBuiltinMasters()).toEqual(BUILTIN_MASTERS);
  });

  it("have their master files and pictures at hand", () => {
    for (const master of Object.values(BUILTIN_MASTERS)) {
      expect(builtinMasterFile(master.file)).toBeDefined();
      for (const layout of master.layouts) {
        for (const shape of layout.shapes) {
          if (shape.kind === "image") {
            expect(builtinAsset(shape.asset)).toBeDefined();
          }
        }
      }
    }
  });

  it("put new slides on a content layout with a title and a number", () => {
    const { winlab, plain } = BUILTIN_MASTERS;
    for (const master of [winlab, plain]) {
      const layout = layoutOf({ master }, undefined);
      expect(layout.name).toBe("Title & Bullets");
      expect(layout.title).toMatchObject({ x: 177.55, y: 9.66, size: 72 });
      expect(layout.number).not.toBeNull();
    }
    expect(winlab.layouts.map((l) => l.name)).toEqual([
      "Title",
      "Title & Bullets",
      "Section",
      "Title, Bullets & Photo",
      "Two Columns",
    ]);
  });
});
