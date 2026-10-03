import { describe, expect, it } from "vitest";

import { migrationNames, pendingMigrations } from "./migrations";

describe("migrationNames", () => {
  it("keeps only NNNN_name.sql files, in name order", () => {
    expect(
      migrationNames([
        ".gitkeep",
        "0002_decks.sql",
        "README.md",
        "1_short.sql",
        "0001_init.sql",
      ])
    ).toEqual(["0001_init.sql", "0002_decks.sql"]);
  });
});

describe("pendingMigrations", () => {
  it("skips the applied ones and keeps the order", () => {
    expect(
      pendingMigrations(
        ["0003_c.sql", "0001_a.sql", "0002_b.sql"],
        ["0002_b.sql"]
      )
    ).toEqual(["0001_a.sql", "0003_c.sql"]);
  });

  it("returns nothing when every file is applied", () => {
    expect(pendingMigrations(["0001_a.sql"], ["0001_a.sql"])).toEqual([]);
  });
});
