import { describe, expect, it } from "vitest";

import { formatPath, parsePath } from "./path";

describe("parsePath", () => {
  it("reads M, L, C, Q and Z with coordinates in the box", () => {
    const d = "M 0 0 L 1000 0 C 1000 500 500 1000 0 1000 Q 0 500 0 0 Z";
    const commands = parsePath(d)!;
    expect(commands.map((c) => c.op)).toEqual(["M", "L", "C", "Q", "Z"]);
    expect(commands[2].points).toEqual([
      [1000, 500],
      [500, 1000],
      [0, 1000],
    ]);
    expect(formatPath(commands)).toBe(d);
  });

  it("refuses other commands, wrong counts and points outside the box", () => {
    for (const d of [
      "",
      "L 0 0",
      "M 0 0 A 1 1 0 0 1 5 5",
      "M 0 0 L 10",
      "M 0 0 L 1001 0",
      "M 0 0 L -1 0",
      "M 0 0 Z 1",
      "M 0 0 <script>",
    ]) {
      expect(parsePath(d), d).toBeNull();
    }
  });
});
