import { describe, expect, it } from "vitest";

import {
  checkClient,
  keycloakAuthorize,
  type McpEnv,
  mcpEnv,
  parseRedirect,
  readAuthorize,
  scopeFor,
  sign,
  unsign,
} from "./oauth";

const env: McpEnv = {
  appUrl: new URL("https://slide.example.org"),
  issuer: new URL("https://auth.example.org/realms/lab"),
  clientId: "slide-mcp",
  audience: "slide-mcp",
  secret: "s".repeat(64),
};
const CHALLENGE = "a".repeat(43);

describe("mcpEnv", () => {
  it("stays off until the MCP client is set", () => {
    const base = {
      APP_URL: "https://slide.example.org",
      OIDC_ISSUER: "https://auth.example.org/realms/lab",
      SESSION_SECRET: "s".repeat(32),
    };
    expect(mcpEnv(base as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(
      mcpEnv({
        ...base,
        MCP_CLIENT_ID: "slide-mcp",
      } as unknown as NodeJS.ProcessEnv)
    ).toMatchObject({ clientId: "slide-mcp", audience: "slide-mcp" });
  });
});

describe("signed values", () => {
  it("round-trips and refuses tampering, other purposes and expiry", () => {
    const token = sign(env, "state", { a: 1 }, 60, 0);
    expect(unsign<{ a: number }>(env, "state", token, 1000)?.a).toBe(1);
    expect(unsign(env, "code", token, 1000)).toBeNull();
    expect(unsign(env, "state", token, 61_000)).toBeNull();
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ a: 2, exp: 99 })).toString(
      "base64url"
    );
    expect(unsign(env, "state", `${forged}.${mac}`, 1000)).toBeNull();
    expect(unsign(env, "state", `${body}.${mac}x`, 1000)).toBeNull();
    expect(unsign(env, "state", "garbage", 1000)).toBeNull();
  });
});

describe("clients", () => {
  const claude = "https://claude.ai/oauth/mcp-oauth-client-metadata";
  const code = "https://claude.ai/oauth/claude-code-client-metadata";
  it("knows Claude by its exact https redirect", () => {
    expect(
      checkClient(
        claude,
        parseRedirect("https://claude.ai/api/mcp/auth_callback")
      )
    ).toEqual({ ok: true, name: "Claude", verified: true });
    expect(
      checkClient(
        claude,
        parseRedirect("https://evil.example/api/mcp/auth_callback")
      ).ok
    ).toBe(false);
  });

  it("lets Claude Code use any loopback port, as an unverified program", () => {
    expect(
      checkClient(code, parseRedirect("http://127.0.0.1:53682/callback"))
    ).toEqual({ ok: true, name: "Claude Code", verified: false });
    expect(
      checkClient(code, parseRedirect("http://127.0.0.1:53682/other")).ok
    ).toBe(false);
  });

  it("keeps unlisted clients to loopback redirects", () => {
    expect(
      checkClient("some-cli", parseRedirect("http://localhost:9000/cb")).ok
    ).toBe(true);
    expect(
      checkClient("some-cli", parseRedirect("https://example.org/cb")).ok
    ).toBe(false);
    expect(parseRedirect("http://example.org/cb")).toBeNull();
    expect(parseRedirect("https://user:pass@example.org/cb")).toBeNull();
    expect(parseRedirect("https://example.org/cb#frag")).toBeNull();
  });
});

describe("readAuthorize", () => {
  const params = (extra: Record<string, string> = {}) =>
    new URLSearchParams({
      response_type: "code",
      client_id: "https://claude.ai/oauth/claude-code-client-metadata",
      redirect_uri: "http://localhost:4000/callback",
      state: "xyz",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      resource: "https://slide.example.org/mcp",
      scope: "openid email admin",
      ...extra,
    });

  it("takes a well-formed request and keeps only known scopes", () => {
    const result = readAuthorize(env, params());
    expect(result.ok && result.request).toMatchObject({
      redirectUri: "http://localhost:4000/callback",
      scope: "openid email",
      state: "xyz",
    });
  });

  it("sends errors back to a trusted redirect, with state and issuer", () => {
    const result = readAuthorize(
      env,
      params({ code_challenge_method: "plain" })
    );
    expect(result.ok).toBe(false);
    const back = new URL((result as { redirect: string }).redirect);
    expect(back.searchParams.get("error")).toBe("invalid_request");
    expect(back.searchParams.get("state")).toBe("xyz");
    expect(back.searchParams.get("iss")).toBe("https://slide.example.org");
    const other = readAuthorize(env, params({ resource: "https://other/mcp" }));
    expect(other.ok).toBe(false);
  });

  it("shows, never sends, an error for an untrusted redirect", () => {
    const result = readAuthorize(
      env,
      params({ redirect_uri: "https://evil.example/cb" })
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { redirect?: string }).redirect).toBeUndefined();
  });

  it("asks Keycloak with the shared client and a signed state", () => {
    const result = readAuthorize(env, params());
    if (!result.ok) throw new Error("expected ok");
    const url = new URL(keycloakAuthorize(env, result.request, "nonce"));
    expect(url.origin + url.pathname).toBe(
      "https://auth.example.org/realms/lab/protocol/openid-connect/auth"
    );
    expect(url.searchParams.get("client_id")).toBe("slide-mcp");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://slide.example.org/oauth/callback"
    );
    expect(url.searchParams.get("code_challenge")).toBe(CHALLENGE);
    expect(unsign(env, "state", url.searchParams.get("state"))).toMatchObject({
      n: "nonce",
    });
  });

  it("always asks for openid", () => {
    expect(scopeFor(null)).toBe("openid");
    expect(scopeFor("offline_access profile")).toBe(
      "openid profile offline_access"
    );
  });
});
