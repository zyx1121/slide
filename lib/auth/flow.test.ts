// Drives the whole sign-in flow against a local OIDC provider
// (oauth2-mock-server), which checks PKCE and echoes the nonce like Keycloak.
import { NextRequest } from "next/server";
import { OAuth2Server } from "oauth2-mock-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { oidc, type AuthEnv } from "./config";
import { finishSignIn, signInCookie, signOut, startSignIn } from "./flow";
import { unseal } from "./seal";
import { sessionCookie, unsealSession } from "./session";

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

function setCookie(response: Response, name: string): string {
  const line = response.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${name}=`));
  if (!line) throw new Error(`no ${name} cookie`);
  return line;
}

function cookieFrom(response: Response, name: string): string {
  return setCookie(response, name)
    .split(";")[0]
    .slice(name.length + 1);
}

/** Login, then the provider's redirect back; returns the callback request. */
async function signInUpTo(
  next: string,
  options: { env?: AuthEnv; tamper?: (url: URL) => void } = {}
) {
  const use = options.env ?? env;
  const login = await startSignIn(
    new NextRequest(
      `${use.appUrl.origin}/auth/login?next=${encodeURIComponent(next)}`
    ),
    use
  );
  expect(login.status).toBe(307);
  const authorize = new URL(login.headers.get("location")!);
  const signIn = cookieFrom(login, signInCookie(use));

  const provider = await fetch(authorize, { redirect: "manual" });
  const callback = new URL(provider.headers.get("location")!);
  options.tamper?.(callback);
  return {
    login,
    authorize,
    signIn,
    request: new NextRequest(callback, {
      headers: { cookie: `${signInCookie(use)}=${signIn}` },
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

  it("draws a new verifier, state and nonce for every sign-in", async () => {
    const first = await signInUpTo("/");
    const second = await signInUpTo("/");
    for (const param of ["state", "nonce", "code_challenge"]) {
      expect(first.authorize.searchParams.get(param)).not.toBe(
        second.authorize.searchParams.get(param)
      );
    }
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
      cookieFrom(response, sessionCookie(env)),
      env.secret
    );
    expect(session?.sub).toBe("alice-sub");
    expect(session?.idToken).toBeTruthy();
    const cookie = setCookie(response, sessionCookie(env));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
  });

  it("sends the PKCE verifier from the sign-in cookie with the code", async () => {
    let sent: unknown;
    const capture = (_: unknown, req: { body?: Record<string, unknown> }) => {
      sent = req.body?.code_verifier;
    };
    server.service.once("beforeResponse", capture);
    const { request, signIn } = await signInUpTo("/");
    await finishSignIn(request, env, async () => {});
    const stored = await unseal<{ v: string }>(signIn, env.secret);
    expect(sent).toBeTruthy();
    expect(sent).toBe(stored?.v);
  });

  it("uses __Host- cookies over https, so a sibling host cannot plant one", async () => {
    const secure = { ...env, appUrl: new URL("https://app.test") };
    const { login, request } = await signInUpTo("/", { env: secure });
    const signIn = setCookie(login, "__Host-slide_sign_in");
    expect(signIn).toMatch(/Secure/);
    expect(signIn).toMatch(/Path=\/(;|$)/);
    expect(signIn).not.toMatch(/Domain=/i);

    const response = await finishSignIn(request, secure, async () => {});
    expect(response.headers.get("location")).toBe("https://app.test/");
    const session = setCookie(response, "__Host-slide_session");
    expect(session).toMatch(/Secure/);
    expect(session).toMatch(/Path=\/(;|$)/);
    expect(session).not.toMatch(/Domain=/i);

    // A plain-named cookie, as a sibling host could set, is not read.
    const planted = new NextRequest(request.url, {
      headers: {
        cookie: `slide_sign_in=${cookieFrom(login, "__Host-slide_sign_in")}`,
      },
    });
    expect(
      (await finishSignIn(planted, secure, async () => {})).headers.get(
        "location"
      )
    ).toBe("https://app.test/auth/error?reason=expired");
  });

  it("never returns to another site", async () => {
    const { request } = await signInUpTo("//evil.example/steal");
    const response = await finishSignIn(request, env, async () => {});
    expect(response.headers.get("location")).toBe("http://app.test/");
  });

  it("refuses a callback whose state was swapped", async () => {
    const onSignIn = vi.fn(async () => {});
    const { request } = await signInUpTo("/", {
      tamper: (url) => url.searchParams.set("state", "forged"),
    });
    const response = await finishSignIn(request, env, onSignIn);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://app.test/auth/error?reason=failed"
    );
    expect(onSignIn).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie().join()).not.toContain(
      `${sessionCookie(env)}=ey`
    );
  });

  it("refuses an ID token whose payload was changed after signing", async () => {
    server.service.once(
      "beforeResponse",
      (response: { body: Record<string, string> }) => {
        const [header, payload, signature] = response.body.id_token.split(".");
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
        claims.sub = "victim-sub";
        const forged = Buffer.from(JSON.stringify(claims)).toString(
          "base64url"
        );
        response.body.id_token = `${header}.${forged}.${signature}`;
      }
    );
    const onSignIn = vi.fn(async () => {});
    const { request } = await signInUpTo("/");
    const response = await finishSignIn(request, env, onSignIn);
    expect(response.headers.get("location")).toBe(
      "http://app.test/auth/error?reason=failed"
    );
    expect(onSignIn).not.toHaveBeenCalled();
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

  it("refuses a plain-http issuer that is not on this machine", async () => {
    // example.com resolves, so a refusal here is the HTTPS rule, not DNS.
    const remote = { ...env, issuer: new URL("http://example.com/realms/x") };
    await expect(oidc(remote)).rejects.toThrow(/HTTPS/);
    const response = await startSignIn(
      new NextRequest("http://app.test/auth/login"),
      remote
    );
    expect(response.headers.get("location")).toBe(
      "http://app.test/auth/error?reason=unavailable"
    );
  });
});

describe("sign-out", () => {
  async function signedIn() {
    const { request } = await signInUpTo("/");
    const response = await finishSignIn(request, env, async () => {});
    return cookieFrom(response, sessionCookie(env));
  }

  function logout(headers: Record<string, string>) {
    return signOut(
      new NextRequest("http://app.test/auth/logout", {
        method: "POST",
        headers,
      }),
      env
    );
  }

  it("signs out of the app and of the provider", async () => {
    const session = await signedIn();
    const response = await logout({
      cookie: `${sessionCookie(env)}=${session}`,
      origin: "http://app.test",
      "sec-fetch-site": "same-origin",
    });
    expect(response.status).toBe(303);
    const target = new URL(response.headers.get("location")!);
    expect(target.origin + target.pathname).toBe(
      `${server.issuer.url}/endsession`
    );
    expect(target.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://app.test/"
    );
    expect(target.searchParams.get("id_token_hint")).toBeTruthy();
    expect(cookieFrom(response, sessionCookie(env))).toBe("");
  });

  it("refuses a cross-site form and clears nothing", async () => {
    const session = await signedIn();
    const attempts: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site" },
      { origin: "https://evil.example" },
    ];
    for (const headers of attempts) {
      const response = await logout({
        cookie: `${sessionCookie(env)}=${session}`,
        ...headers,
      });
      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it("clears nothing when the request carries no session", async () => {
    const response = await logout({ "sec-fetch-site": "same-origin" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://app.test/");
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
