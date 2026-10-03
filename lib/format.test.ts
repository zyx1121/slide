import { describe, expect, it } from "vitest";

import { formatDateTime } from "./format";

describe("formatDateTime", () => {
  it("formats in Taiwan time whatever the server's zone", () => {
    // 23:30 UTC on 2 October is 07:30 on 3 October in Taipei.
    expect(formatDateTime(new Date("2026-10-02T23:30:00Z"))).toBe(
      "2026/10/03 07:30"
    );
  });

  it("writes midnight as 00, not 24", () => {
    expect(formatDateTime(new Date("2026-10-02T16:00:00Z"))).toBe(
      "2026/10/03 00:00"
    );
  });
});
