import { describe, expect, it, vi } from "vitest";

import { approve, callback } from "./flow";
import { FORM_LIMIT, type McpEnv, readAuthorize, sign, unsign } from "./oauth";
import { token } from "./token-endpoint";

const env: McpEnv = {
  appUrl: new URL("https://slide.example.org"),
  issuer: new URL("https://auth.example.org/realms/lab"),
  clientId: "slide-mcp",
  audience: "slide-mcp",
  secret: "s".repeat(64),
};
const authorized = readAuthorize(
  env,
  new URLSearchParams({
    response_type: "code",
    client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    state: "client-state",
    code_challenge: "b".repeat(43),
    code_challenge_method: "S256",
  })
);
if (!authorized.ok) throw new Error("fixture");
const request = authorized.request;

const post = (
  url: string,
  form: Record<string, string>,
  headers: Record<string, string> = {}
) =>
  new Request(url, {
    method: "POST",
    body: new URLSearchParams(form),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
  });

describe("approve", () => {
  const tx = sign(env, "consent", { r: request }, 600);
  it("refuses another site's form", async () => {
    const response = await approve(
      env,
      post(
        "https://slide.example.org/oauth/approve",
        { tx, decision: "allow" },
        {
          origin: "https://evil.example",
        }
      )
    );
    expect(response.status).toBe(403);
  });

  it("sends a denial back to the client", async () => {
    const response = await approve(
      env,
      post(
        "https://slide.example.org/oauth/approve",
        { tx, decision: "deny" },
        {
          origin: "https://slide.example.org",
        }
      )
    );
    const back = new URL(response.headers.get("location")!);
    expect(back.origin).toBe("https://claude.ai");
    expect(back.searchParams.get("error")).toBe("access_denied");
  });

  it("sends an approval to Keycloak with a cookie for this browser", async () => {
    const response = await approve(
      env,
      post(
        "https://slide.example.org/oauth/approve",
        { tx, decision: "allow" },
        {
          origin: "https://slide.example.org",
          "sec-fetch-site": "same-origin",
        }
      )
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(
      /^https:\/\/auth\.example\.org\/realms\/lab\/protocol\/openid-connect\/auth\?/
    );
    expect(response.headers.get("set-cookie")).toMatch(
      /^__Host-slide_mcp_flow=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/
    );
  });

  it("refuses an expired or forged consent", async () => {
    const response = await approve(
      env,
      post(
        "https://slide.example.org/oauth/approve",
        { tx: "x.y", decision: "allow" },
        { origin: "https://slide.example.org" }
      )
    );
    expect(response.status).toBe(400);
  });

  it("refuses a form that says nothing of where it came from", async () => {
    const response = await approve(
      env,
      post("https://slide.example.org/oauth/approve", { tx, decision: "allow" })
    );
    expect(response.status).toBe(403);
  });

  it("stops reading a form larger than any consent", async () => {
    const response = await approve(
      env,
      post(
        "https://slide.example.org/oauth/approve",
        { tx, decision: "allow", pad: "x".repeat(FORM_LIMIT) },
        { origin: "https://slide.example.org" }
      )
    );
    expect(response.status).toBe(413);
  });
});

describe("callback", () => {
  const state = sign(env, "state", { r: request, n: "nonce-1" }, 600);
  const back = (cookie: string, extra = "&code=kc-code") =>
    callback(
      env,
      new Request(
        `https://slide.example.org/oauth/callback?state=${encodeURIComponent(state)}${extra}`,
        { headers: { cookie } }
      )
    );

  it("needs the browser that approved", () => {
    expect(back("__Host-slide_mcp_flow=other").status).toBe(400);
    expect(back("").status).toBe(400);
    // A look-alike name, as a sibling site could set, does not count.
    expect(back("\u00a0__Host-slide_mcp_flow=nonce-1").status).toBe(400);
  });

  it("sends the client a wrapped code, its state and our issuer", () => {
    const response = back("__Host-slide_mcp_flow=nonce-1");
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(
      "https://claude.ai/api/mcp/auth_callback"
    );
    expect(location.searchParams.get("state")).toBe("client-state");
    expect(location.searchParams.get("iss")).toBe("https://slide.example.org");
    expect(
      unsign(env, "code", location.searchParams.get("code"))
    ).toMatchObject({
      k: "kc-code",
      c: request.clientId,
      u: request.redirectUri,
    });
  });
});

describe("token", () => {
  const code = sign(
    env,
    "code",
    { k: "kc-code", c: request.clientId, u: request.redirectUri },
    300
  );
  const keycloak = vi.fn(async () =>
    Response.json({ access_token: "jwt", token_type: "Bearer" })
  );

  it("relays a wrapped code with the shared client and our callback", async () => {
    const response = await token(
      env,
      post("https://slide.example.org/oauth/token", {
        grant_type: "authorization_code",
        code,
        client_id: request.clientId,
        redirect_uri: request.redirectUri,
        code_verifier: "v".repeat(43),
      }),
      keycloak as unknown as typeof fetch
    );
    expect(await response.json()).toEqual({
      access_token: "jwt",
      token_type: "Bearer",
    });
    const [url, init] = keycloak.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://auth.example.org/realms/lab/protocol/openid-connect/token"
    );
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      client_id: "slide-mcp",
      grant_type: "authorization_code",
      code: "kc-code",
      redirect_uri: "https://slide.example.org/oauth/callback",
      code_verifier: "v".repeat(43),
    });
  });

  it("refuses a code for another client or redirect", async () => {
    for (const [client_id, redirect_uri] of [
      ["someone-else", request.redirectUri],
      [request.clientId, "http://localhost/callback"],
    ]) {
      const response = await token(
        env,
        post("https://slide.example.org/oauth/token", {
          grant_type: "authorization_code",
          code,
          client_id,
          redirect_uri,
          code_verifier: "v".repeat(43),
        }),
        keycloak as unknown as typeof fetch
      );
      expect(await response.json()).toEqual({ error: "invalid_grant" });
    }
  });

  it("relays a refresh and refuses other grants", async () => {
    keycloak.mockClear();
    await token(
      env,
      post("https://slide.example.org/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: "rt",
      }),
      keycloak as unknown as typeof fetch
    );
    const [, init] = keycloak.mock.calls[0] as unknown as [string, RequestInit];
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      client_id: "slide-mcp",
      grant_type: "refresh_token",
      refresh_token: "rt",
    });
    const other = await token(
      env,
      post("https://slide.example.org/oauth/token", { grant_type: "password" })
    );
    expect(await other.json()).toEqual({ error: "unsupported_grant_type" });
  });

  it("refuses a body over the limit, sent or declared, without asking Keycloak", async () => {
    keycloak.mockClear();
    const sent = await token(
      env,
      post("https://slide.example.org/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: "r".repeat(FORM_LIMIT),
      }),
      keycloak as unknown as typeof fetch
    );
    expect(sent.status).toBe(413);
    expect(await sent.json()).toEqual({ error: "invalid_request" });
    // A declared length over the limit is refused before a byte is read.
    const declared = await token(
      env,
      {
        headers: new Headers({ "content-length": String(FORM_LIMIT + 1) }),
        get body(): never {
          throw new Error("the body was read");
        },
      } as unknown as Request,
      keycloak as unknown as typeof fetch
    );
    expect(declared.status).toBe(413);
    expect(keycloak).not.toHaveBeenCalled();
  });

  it("answers a body that breaks off midway instead of throwing", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("grant_type=refresh_"));
        controller.error(new Error("aborted"));
      },
    });
    const response = await token(
      env,
      new Request("https://slide.example.org/oauth/token", {
        method: "POST",
        body,
        duplex: "half",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      } as RequestInit),
      keycloak as unknown as typeof fetch
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});
