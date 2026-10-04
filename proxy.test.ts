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
    OIDC_ISSUER: "https://auth.example/realms/test",
    OIDC_CLIENT_ID: "slide",
    OIDC_CLIENT_SECRET: "client-secret",
    SESSION_SECRET: secret,
    ALLOWED_EMAILS: "Alice@Example.com, bob@example.com",
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

  it("lets a Server Action POST through to its own session check", async () => {
    const action = (method: string, headers: Record<string, string>) =>
      proxy(
        new NextRequest("http://internal:3000/decks/dk_2345", {
          method,
          headers,
        })
      );
    const post = await action("POST", { "next-action": "abc123" });
    expect(post.headers.get("x-middleware-next")).toBe("1");
    // Only a POST is an action: a GET with the header meets the gate.
    expect((await action("GET", { "next-action": "abc123" })).status).toBe(307);
    expect((await action("POST", {})).status).toBe(307);
  });

  it("lets a member with a valid session through", async () => {
    const token = await sealSession(
      { sub: "alice-sub", name: "Alice", email: "alice@example.com" },
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
      { sub: "alice-sub", name: "Alice", email: "alice@example.com" },
      secret
    );
    const response = await proxy(
      new NextRequest("http://internal:3000/", {
        headers: { cookie: `slide_session=${token}` },
      })
    );
    expect(response.status).toBe(307);
  });

  it("turns away a session whose email is not on the allowlist", async () => {
    const token = await sealSession(
      { sub: "carol-sub", name: "Carol", email: "carol@example.com" },
      secret
    );
    const response = await proxy(
      new NextRequest("http://internal:3000/", {
        headers: { cookie: `${SESSION}=${token}` },
      })
    );
    expect(response.status).toBe(307);
  });

  it("treats a forged session as no session", async () => {
    const forged = await sealSession(
      { sub: "alice-sub", name: "", email: "alice@example.com" },
      "f".repeat(32)
    );
    const response = await proxy(
      new NextRequest("http://internal:3000/", {
        headers: { cookie: `${SESSION}=${forged}` },
      })
    );
    expect(response.status).toBe(307);
  });

  it("leaves sign-in, the health check, uploads, MCP and its OAuth front, public decks and static files alone", () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    for (const path of [
      "/",
      "/decks/dk_2345",
      "/settings",
      "/api/healthz",
      "/api/assets/" + "a".repeat(64),
    ]) {
      expect(pattern.test(path)).toBe(true);
    }
    for (const path of [
      "/auth/login",
      "/auth/callback",
      "/api/health",
      "/api/assets",
      "/api/decks/import",
      "/mcp",
      "/oauth/token",
      "/oauth/approve",
      "/oauth/callback",
      "/.well-known/oauth-authorization-server",
      "/s/abc",
      "/template/winlab-background.png",
      "/_next/static/chunk.js",
      "/favicon.ico",
    ]) {
      expect(pattern.test(path)).toBe(false);
    }
  });
});
