import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

import { sealSession } from "@/lib/auth/session";

import { config, proxy } from "./proxy";

const secret = "s".repeat(32);
// APP_URL is https here, so the session cookie carries the __Host- prefix.
const SESSION = "__Host-slide_session";

beforeAll(() => {
  Object.assign(process.env, {
    APP_URL: "https://slide.example",
    KEYCLOAK_ISSUER: "https://auth.example/realms/test",
    KEYCLOAK_CLIENT_ID: "slide",
    KEYCLOAK_CLIENT_SECRET: "client-secret",
    SESSION_SECRET: secret,
  });
});

describe("proxy", () => {
  it("sends a visitor without a session to sign-in, keeping the path", async () => {
    const response = await proxy(
      new NextRequest("http://internal:3000/decks/dk_2345?x=1")
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://slide.example/auth/login?next=%2Fdecks%2Fdk_2345%3Fx%3D1"
    );
  });

  it("lets a member with a valid session through", async () => {
    const token = await sealSession(
      { sub: "alice-sub", name: "Alice", email: "" },
      secret
    );
    const response = await proxy(
      new NextRequest("http://internal:3000/", {
        headers: { cookie: `${SESSION}=${token}` },
      })
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("ignores a valid session under the plain name over https", async () => {
    const token = await sealSession(
      { sub: "alice-sub", name: "Alice", email: "" },
      secret
    );
    const response = await proxy(
      new NextRequest("http://internal:3000/", {
        headers: { cookie: `slide_session=${token}` },
      })
    );
    expect(response.status).toBe(307);
  });

  it("treats a forged session as no session", async () => {
    const forged = await sealSession(
      { sub: "alice-sub", name: "", email: "" },
      "f".repeat(32)
    );
    const response = await proxy(
      new NextRequest("http://internal:3000/", {
        headers: { cookie: `${SESSION}=${forged}` },
      })
    );
    expect(response.status).toBe(307);
  });

  it("leaves sign-in, the health check, public decks and static files alone", () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/", "/decks/dk_2345", "/settings", "/api/healthz"]) {
      expect(pattern.test(path)).toBe(true);
    }
    for (const path of [
      "/auth/login",
      "/auth/callback",
      "/api/health",
      "/s/abc",
      "/_next/static/chunk.js",
      "/favicon.ico",
    ]) {
      expect(pattern.test(path)).toBe(false);
    }
  });
});
