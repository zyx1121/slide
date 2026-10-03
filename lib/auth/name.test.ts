import { describe, expect, it } from "vitest";

import { displayName } from "./name";

describe("displayName", () => {
  it("writes a CJK name last name first, with no space", () => {
    expect(
      displayName({ given_name: "詠翔", family_name: "詹", name: "詠翔 詹" })
    ).toBe("詹詠翔");
    expect(displayName({ given_name: "太郎", family_name: "山田" })).toBe(
      "山田太郎"
    );
  });

  it("keeps Keycloak's name for Latin and mixed names", () => {
    expect(
      displayName({
        given_name: "Alice",
        family_name: "Chen",
        name: "Alice Chen",
      })
    ).toBe("Alice Chen");
    expect(
      displayName({ given_name: "Loki", family_name: "詹", name: "Loki 詹" })
    ).toBe("Loki 詹");
  });

  it("falls back to the parts, then the username", () => {
    expect(displayName({ given_name: "Alice", family_name: "Chen" })).toBe(
      "Alice Chen"
    );
    expect(displayName({ preferred_username: "zyx1121" })).toBe("zyx1121");
    expect(displayName({ name: 42, given_name: " " })).toBe("");
  });
});
