// requireUser is the check every page makes itself, behind proxy.ts. These
// tests stand in for Next's cookies() and redirect().
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

const { requireUser, sealSession } = await import("./session");

const secret = "s".repeat(32);

beforeEach(() => {
  jar.clear();
  Object.assign(process.env, {
    APP_URL: "https://slide.example",
    OIDC_ISSUER: "https://auth.example/realms/test",
    OIDC_CLIENT_ID: "slide",
    OIDC_CLIENT_SECRET: "client-secret",
    SESSION_SECRET: secret,
    ALLOWED_EMAILS: "Alice@Example.com, bob@example.com",
  });
});

describe("requireUser", () => {
  it("sends a request without a session to sign-in", async () => {
    await expect(requireUser()).rejects.toThrow("redirect /auth/login");
  });

  it("returns the member of a valid __Host- session", async () => {
    jar.set(
      "__Host-slide_session",
      await sealSession(
        { sub: "alice-sub", name: "Alice", email: "alice@example.com" },
        secret
      )
    );
    await expect(requireUser()).resolves.toEqual({
      sub: "alice-sub",
      name: "Alice",
      email: "alice@example.com",
    });
  });

  it("signs out a member whose email left the allowlist", async () => {
    jar.set(
      "__Host-slide_session",
      await sealSession(
        { sub: "carol-sub", name: "Carol", email: "carol@example.com" },
        secret
      )
    );
    await expect(requireUser()).rejects.toThrow("redirect /auth/login");
  });

  it("ignores a plain-named or forged session over https", async () => {
    jar.set(
      "slide_session",
      await sealSession(
        { sub: "alice-sub", name: "", email: "alice@example.com" },
        secret
      )
    );
    await expect(requireUser()).rejects.toThrow("redirect /auth/login");
    jar.set(
      "__Host-slide_session",
      await sealSession(
        { sub: "alice-sub", name: "", email: "alice@example.com" },
        "f".repeat(32)
      )
    );
    await expect(requireUser()).rejects.toThrow("redirect /auth/login");
  });
});
