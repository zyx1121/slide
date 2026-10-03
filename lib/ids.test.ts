import { describe, expect, it } from "vitest";

import { newId } from "./ids";

describe("newId", () => {
  it("is the prefix, an underscore and 8 unambiguous characters", () => {
    expect(newId("sh")).toMatch(/^sh_[2-9a-hjkmnp-z]{8}$/);
    expect(newId("dk", 10)).toMatch(/^dk_[2-9a-hjkmnp-z]{10}$/);
  });

  it("does not repeat across many draws", () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => newId("sh")));
    expect(ids.size).toBe(20_000);
  });

  it("uses every character of the alphabet about equally", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      for (const ch of newId("x", 8).slice(2)) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(31);
    const expected = (4000 * 8) / 31;
    for (const count of counts.values()) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.15);
    }
  });
});
