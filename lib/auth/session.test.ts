import { describe, expect, it, vi } from "vitest";

import { seal, unseal } from "./seal";
import { sealSession, unsealSession } from "./session";

const secret = "s".repeat(32);

describe("session cookie", () => {
  it("round-trips the member", async () => {
    const token = await sealSession(
      { sub: "alice-sub", name: "Alice", email: "alice@example.com" },
      secret
    );
    expect(await unsealSession(token, secret)).toEqual({
      sub: "alice-sub",
      name: "Alice",
      email: "alice@example.com",
      idToken: undefined,
    });
  });

  it("refuses a token sealed with another secret or tampered with", async () => {
    const token = await sealSession(
      { sub: "alice-sub", name: "", email: "" },
      secret
    );
    expect(await unsealSession(token, "t".repeat(32))).toBeNull();
    const parts = token.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(await unsealSession(parts.join("."), secret)).toBeNull();
    expect(await unsealSession("not-a-token", secret)).toBeNull();
  });

  it("expires", async () => {
    const token = await seal({ sub: "alice-sub" }, secret, 60);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    try {
      expect(await unseal(token, secret)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an ID token that would make the cookie too large", async () => {
    const small = await sealSession(
      { sub: "a", name: "", email: "", idToken: "x".repeat(100) },
      secret
    );
    expect((await unsealSession(small, secret))?.idToken).toBe("x".repeat(100));
    const large = await sealSession(
      { sub: "a", name: "", email: "", idToken: "x".repeat(5000) },
      secret
    );
    expect(large.length).toBeLessThan(3800);
    expect((await unsealSession(large, secret))?.idToken).toBeUndefined();
  });
});
