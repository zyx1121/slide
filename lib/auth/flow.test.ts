// Drives the whole sign-in flow against a local OIDC provider
// (oauth2-mock-server), which checks PKCE and echoes the nonce like Keycloak.
import { NextRequest } from "next/server";
import { OAuth2Server } from "oauth2-mock-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AuthEnv } from "./config";
import { finishSignIn, SIGN_IN_COOKIE, signOut, startSignIn } from "./flow";
import { SESSION_COOKIE, unsealSession } from "./session";

let server: OAuth2Server;
let env: AuthEnv;

beforeAll(async () => {
  server = new OAuth2Server();
  await server.issuer.keys.generate("RS256");
  await server.start(0, "127.0.0.1");
  server.service.on("beforeTokenSigning", (token) => {
    token.payload.sub = "alice-sub";
    token.payload.name = "Alice";
    token.payload.email = "alice@example.com";
  });
  env = {
    appUrl: new URL("http://app.test"),
    issuer: new URL(server.issuer.url!),
    clientId: "slide",
    clientSecret: "client-secret",
    secret: "s".repeat(32),
  };
});

afterAll(async () => {
  await server.stop();
});

function cookieFrom(response: Response, name: string): string {
  const header = response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${name}=`));
  if (!header) throw new Error(`no ${name} cookie`);
  return header.split(";")[0].slice(name.length + 1);
}

/** Login, then the provider's redirect back; returns the callback request. */
async function signInUpTo(next: string, tamper?: (url: URL) => void) {
  const login = await startSignIn(
    new NextRequest(
      `http://app.test/auth/login?next=${encodeURIComponent(next)}`
    ),
    env
  );
  expect(login.status).toBe(307);
  const authorize = new URL(login.headers.get("location")!);
  const signIn = cookieFrom(login, SIGN_IN_COOKIE);

  const provider = await fetch(authorize, { redirect: "manual" });
  const callback = new URL(provider.headers.get("location")!);
  tamper?.(callback);
  return {
    authorize,
    request: new NextRequest(callback, {
      headers: { cookie: `${SIGN_IN_COOKIE}=${signIn}` },
    }),
  };
}

describe("sign-in flow", () => {
  it("sends the member to the provider with PKCE, state and nonce", async () => {
    const { authorize } = await signInUpTo("/");
    expect(authorize.origin + authorize.pathname).toBe(
      `${server.issuer.url}/authorize`
    );
    const params = authorize.searchParams;
    expect(params.get("client_id")).toBe("slide");
    expect(params.get("redirect_uri")).toBe("http://app.test/auth/callback");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("state")).toBeTruthy();
    expect(params.get("nonce")).toBeTruthy();
    expect(params.get("scope")).toBe("openid profile email");
  });

  it("signs the member in, records them, and returns to the page they wanted", async () => {
    const onSignIn = vi.fn(async () => {});
    const { request } = await signInUpTo("/decks/dk_2345?x=1");
    const response = await finishSignIn(request, env, onSignIn);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://app.test/decks/dk_2345?x=1"
    );
    expect(onSignIn).toHaveBeenCalledWith({
      sub: "alice-sub",
      name: "Alice",
      email: "alice@example.com",
    });
    const session = await unsealSession(
      cookieFrom(response, SESSION_COOKIE),
      env.secret
    );
    expect(session?.sub).toBe("alice-sub");
    expect(session?.idToken).toBeTruthy();
    const cookie = response.headers
      .getSetCookie()
      .find((line) => line.startsWith(`${SESSION_COOKIE}=`))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
  });

  it("never returns to another site", async () => {
    const { request } = await signInUpTo("//evil.example/steal");
    const response = await finishSignIn(request, env, async () => {});
    expect(response.headers.get("location")).toBe("http://app.test/");
  });

  it("refuses a callback whose state was swapped", async () => {
    const onSignIn = vi.fn(async () => {});
    const { request } = await signInUpTo("/", (url) =>
      url.searchParams.set("state", "forged")
    );
    const response = await finishSignIn(request, env, onSignIn);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://app.test/auth/error?reason=failed"
    );
    expect(onSignIn).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie().join()).not.toContain(
      `${SESSION_COOKIE}=ey`
    );
  });

  it("refuses a callback without the sign-in cookie", async () => {
    const { request } = await signInUpTo("/");
    const bare = new NextRequest(request.url);
    const response = await finishSignIn(bare, env, async () => {});
    expect(response.headers.get("location")).toBe(
      "http://app.test/auth/error?reason=expired"
    );
  });

  it("refuses a code replayed from another browser's sign-in", async () => {
    const first = await signInUpTo("/");
    const second = await signInUpTo("/");
    const mixed = new NextRequest(first.request.url, {
      headers: { cookie: second.request.headers.get("cookie")! },
    });
    const response = await finishSignIn(mixed, env, async () => {});
    expect(response.headers.get("location")).toBe(
      "http://app.test/auth/error?reason=failed"
    );
  });

  it("sends the member to the error page when the provider is down", async () => {
    const down = { ...env, issuer: new URL("http://127.0.0.1:9/realms/none") };
    const response = await startSignIn(
      new NextRequest("http://app.test/auth/login"),
      down
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://app.test/auth/error?reason=unavailable"
    );
  });

  it("signs out of the app and of the provider", async () => {
    const { request } = await signInUpTo("/");
    const signedIn = await finishSignIn(request, env, async () => {});
    const session = cookieFrom(signedIn, SESSION_COOKIE);

    const response = await signOut(
      new NextRequest("http://app.test/auth/logout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${session}` },
      }),
      env
    );
    expect(response.status).toBe(303);
    const target = new URL(response.headers.get("location")!);
    expect(target.origin + target.pathname).toBe(
      `${server.issuer.url}/endsession`
    );
    expect(target.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://app.test/"
    );
    expect(target.searchParams.get("id_token_hint")).toBeTruthy();
    expect(cookieFrom(response, SESSION_COOKIE)).toBe("");
  });
});
