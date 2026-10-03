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
    KEYCLOAK_ISSUER: "https://auth.example/realms/test",
    KEYCLOAK_CLIENT_ID: "slide",
    KEYCLOAK_CLIENT_SECRET: "client-secret",
    SESSION_SECRET: secret,
  });
});

describe("requireUser", () => {
  it("sends a request without a session to sign-in", async () => {
    await expect(requireUser()).rejects.toThrow("redirect /auth/login");
  });

  it("returns the member of a valid __Host- session", async () => {
    jar.set(
      "__Host-slide_session",
      await sealSession({ sub: "alice-sub", name: "Alice", email: "" }, secret)
    );
    await expect(requireUser()).resolves.toEqual({
      sub: "alice-sub",
      name: "Alice",
      email: "",
    });
  });

  it("ignores a plain-named or forged session over https", async () => {
    jar.set(
      "slide_session",
      await sealSession({ sub: "alice-sub", name: "", email: "" }, secret)
    );
    await expect(requireUser()).rejects.toThrow("redirect /auth/login");
    jar.set(
      "__Host-slide_session",
      await sealSession(
        { sub: "alice-sub", name: "", email: "" },
        "f".repeat(32)
      )
    );
    await expect(requireUser()).rejects.toThrow("redirect /auth/login");
  });
});
