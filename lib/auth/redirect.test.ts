import { describe, expect, it } from "vitest";

import { safeNext } from "./redirect";

describe("safeNext", () => {
  it("keeps same-site paths with their query", () => {
    expect(safeNext("/decks/dk_2345?tab=1")).toBe("/decks/dk_2345?tab=1");
    expect(safeNext("/")).toBe("/");
  });

  it("falls back to / for anything that could leave the site", () => {
    for (const next of [
      null,
      undefined,
      "",
      "decks",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "/\u0009/evil.example",
      "/ok\r\nSet-Cookie: x=1",
    ]) {
      expect(safeNext(next)).toBe("/");
    }
  });
});
