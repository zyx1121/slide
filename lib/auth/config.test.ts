import { describe, expect, it } from "vitest";

import { authEnv, isAllowed } from "./config";

const base = {
  APP_URL: "https://slide.example",
  OIDC_ISSUER: "https://accounts.google.com",
  OIDC_CLIENT_ID: "slide",
  OIDC_CLIENT_SECRET: "client-secret",
  SESSION_SECRET: "s".repeat(32),
  ALLOWED_EMAILS: " Alice@Example.com,,bob@example.com ",
} as unknown as NodeJS.ProcessEnv;

describe("authEnv", () => {
  it("reads the allowlist without case or spaces", () => {
    const env = authEnv(base);
    expect([...env.allowed]).toEqual(["alice@example.com", "bob@example.com"]);
    expect(isAllowed(env, "ALICE@example.com ")).toBe(true);
    expect(isAllowed(env, "carol@example.com")).toBe(false);
    expect(isAllowed(env, "")).toBe(false);
  });

  it("fails closed without an allowlist", () => {
    expect(() => authEnv({ ...base, ALLOWED_EMAILS: "" })).toThrow(
      "ALLOWED_EMAILS"
    );
    expect(() => authEnv({ ...base, ALLOWED_EMAILS: " , " })).toThrow(
      "at least one"
    );
  });
});
