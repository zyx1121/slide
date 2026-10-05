// Writes lib/master/builtin.json: the built-in masters (template/*.pptx) as
// the deck document holds them. Run from the repository after changing a
// template:
//   bun scripts/masters.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { readBuiltinMasters } from "../lib/master/build";

const out = await readBuiltinMasters();
writeFileSync(
  join(process.cwd(), "lib/master/builtin.json"),
  `${JSON.stringify(out, null, 2)}\n`
);
console.log(
  Object.entries(out)
    .map(
      ([id, m]) =>
        `${id}: ${m.layouts.length} layouts, file ${m.file.slice(0, 12)}`
    )
    .join("\n")
);
