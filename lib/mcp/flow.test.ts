// The MCP authorization server end to end: consent, code, tokens, refresh
// and the access check, against a real Postgres (TEST_DATABASE_URL).
import { createHash } from "node:crypto";

import { NextRequest } from "next/server";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sealSession } from "../auth/session";
import { ensureUser } from "../deck/store";
import { createTestDb, TEST_DATABASE_URL } from "../test-db";
import { approve } from "./flow";
import {
  bearer,
  type TokenPair,
  verifyAccessToken,
  REUSE_GRACE_SECONDS,
} from "./grants";
import { FORM_LIMIT, mcpEnv, readAuthorize, sign } from "./oauth";
import { token } from "./token-endpoint";

const SETTINGS = {
  APP_URL: "https://slide.example.org",
  OIDC_ISSUER: "https://accounts.google.com",
  OIDC_CLIENT_ID: "slide",
  OIDC_CLIENT_SECRET: "client-secret",
  SESSION_SECRET: "s".repeat(64),
  ALLOWED_EMAILS: "alice@example.com",
} as unknown as NodeJS.ProcessEnv;
const env = mcpEnv(SETTINGS)!;

const CLIENT = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const authorized = readAuthorize(
  env,
  new URLSearchParams({
    response_type: "code",
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    state: "client-state",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
  })
);
if (!authorized.ok) throw new Error("fixture");
const request = authorized.request;

const form = (
  url: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {}
) =>
  new NextRequest(url, {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
  });

const ALICE = { sub: "alice-sub", name: "Alice", email: "alice@example.com" };
const consent = (member = ALICE.sub) =>
  sign(env, "consent", { r: request, m: member }, 600);
const sessionCookie = async (user = ALICE) =>
  `__Host-slide_session=${await sealSession(user, env.secret)}`;

const approveAs = async (
  fields: Record<string, string>,
  headers: Record<string, string> = {},
  db: postgres.Sql
) =>
  approve(
    env,
    form("https://slide.example.org/oauth/approve", fields, {
      origin: "https://slide.example.org",
      ...headers,
    }),
    db
  );

const tokenCall = (db: postgres.Sql, fields: Record<string, string>) =>
  token(env, form("https://slide.example.org/oauth/token", fields), db);

describe("approve, without a database", () => {
  const db = null as unknown as postgres.Sql;

  it("refuses another site's form, or one that says nothing of its origin", async () => {
    const tx = consent();
    const evil = await approveAs(
      { tx, decision: "allow" },
      { origin: "https://evil.example" },
      db
    );
    expect(evil.status).toBe(403);
    const bare = await approve(
      env,
      new NextRequest("https://slide.example.org/oauth/approve", {
        method: "POST",
        body: new URLSearchParams({ tx, decision: "allow" }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      db
    );
    expect(bare.status).toBe(403);
  });

  it("refuses an expired or forged consent", async () => {
    const response = await approveAs(
      { tx: "forged.value", decision: "allow" },
      { cookie: await sessionCookie() },
      db
    );
    expect(response.status).toBe(400);
  });

  it("refuses a member other than the one the page was shown to", async () => {
    const response = await approveAs(
      { tx: consent("mallory-sub"), decision: "allow" },
      { cookie: await sessionCookie() },
      db
    );
    expect(response.status).toBe(403);
    const signedOut = await approveAs(
      { tx: consent(), decision: "allow" },
      {},
      db
    );
    expect(signedOut.status).toBe(403);
  });

  it("refuses a member who left the allowlist", async () => {
    const carol = {
      sub: "alice-sub",
      name: "Alice",
      email: "carol@example.com",
    };
    const response = await approveAs(
      { tx: consent(), decision: "allow" },
      { cookie: await sessionCookie(carol) },
      db
    );
    expect(response.status).toBe(403);
  });

  it("sends a denial back to the client, with state and issuer", async () => {
    const response = await approveAs(
      { tx: consent(), decision: "deny" },
      { cookie: await sessionCookie() },
      db
    );
    const back = new URL(response.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("client-state");
    expect(back.searchParams.get("iss")).toBe("https://slide.example.org");
  });
});

describe("token endpoint, without a database", () => {
  const db = null as unknown as postgres.Sql;

  it("refuses unknown grants and malformed requests", async () => {
    const other = await tokenCall(db, {
      grant_type: "password",
      client_id: CLIENT,
    });
    expect(await other.json()).toEqual({ error: "unsupported_grant_type" });
    const noClient = await tokenCall(db, {
      grant_type: "refresh_token",
      refresh_token: "x",
    });
    expect(await noClient.json()).toEqual({ error: "invalid_request" });
    const shortVerifier = await tokenCall(db, {
      grant_type: "authorization_code",
      client_id: CLIENT,
      code: "x",
      code_verifier: "short",
    });
    expect(await shortVerifier.json()).toEqual({ error: "invalid_request" });
  });

  it("refuses a body over the limit, sent or declared", async () => {
    const sent = await tokenCall(db, {
      grant_type: "refresh_token",
      client_id: CLIENT,
      refresh_token: "r".repeat(FORM_LIMIT),
    });
    expect(sent.status).toBe(413);
    const declared = await token(
      env,
      {
        headers: new Headers({ "content-length": String(FORM_LIMIT + 1) }),
        get body(): never {
          throw new Error("the body was read");
        },
      } as unknown as Request,
      db
    );
    expect(declared.status).toBe(413);
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
      db
    );
    expect(response.status).toBe(400);
  });

  it("reads a bearer token from the header only", () => {
    const with_ = (value: string) =>
      bearer(new Request("https://x", { headers: { authorization: value } }));
    expect(with_("Bearer abc.def")).toBe("abc.def");
    expect(with_("Basic abc")).toBeNull();
    expect(with_("Bearer a b")).toBeNull();
  });
});

describe.skipIf(!TEST_DATABASE_URL)("grants (Postgres)", () => {
  let db: postgres.Sql;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await ensureUser(db, ALICE);
  });
  afterAll(async () => {
    await drop?.();
  });

  /** Consent through to a code, as the browser would. */
  async function codeFor(): Promise<string> {
    const response = await approveAs(
      { tx: consent(), decision: "allow" },
      { cookie: await sessionCookie() },
      db
    );
    expect(response.status).toBe(303);
    const back = new URL(response.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("client-state");
    expect(back.searchParams.get("iss")).toBe("https://slide.example.org");
    return back.searchParams.get("code")!;
  }

  const redeem = (code: string, extra: Record<string, string> = {}) =>
    tokenCall(db, {
      grant_type: "authorization_code",
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      code,
      code_verifier: VERIFIER,
      ...extra,
    });

  const refreshWith = (refresh_token: string, client_id = CLIENT) =>
    tokenCall(db, { grant_type: "refresh_token", client_id, refresh_token });

  async function pair(): Promise<TokenPair> {
    const response = await redeem(await codeFor());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return response.json();
  }

  it("stores codes and refresh tokens only by their hash", async () => {
    const code = await codeFor();
    const rows = await db`select hash from mcp_codes`;
    expect(rows.some((row) => row.hash === code)).toBe(false);
    const tokens: TokenPair = await (await redeem(code)).json();
    const stored = await db`select hash from mcp_refresh_tokens`;
    expect(stored.some((row) => row.hash === tokens.refresh_token)).toBe(false);
  });

  it("trades a code once, with the right verifier, client and redirect", async () => {
    const tokens = await pair();
    expect(tokens).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "decks",
    });
    expect(await verifyAccessToken(db, env, tokens.access_token)).toMatchObject(
      {
        sub: "alice-sub",
        clientId: CLIENT,
      }
    );

    const code = await codeFor();
    expect((await redeem(code)).status).toBe(200);
    // Spent: the same code again is refused.
    expect(await (await redeem(code)).json()).toEqual({
      error: "invalid_grant",
    });

    const wrongs: Record<string, string>[] = [
      { code_verifier: "w".repeat(43) },
      { client_id: "https://other.example/client" },
      { redirect_uri: "https://claude.ai/api/mcp/other" },
    ];
    for (const wrong of wrongs) {
      const fresh = await codeFor();
      expect(await (await redeem(fresh, wrong)).json()).toEqual({
        error: "invalid_grant",
      });
      // A failed try spends the code too.
      expect(await (await redeem(fresh)).json()).toEqual({
        error: "invalid_grant",
      });
    }
  });

  it("refuses an expired code", async () => {
    const code = await codeFor();
    await db`update mcp_codes set expires_at = now() - interval '1 second'`;
    expect(await (await redeem(code)).json()).toEqual({
      error: "invalid_grant",
    });
  });

  it("rotates refresh tokens, forgives a quick retry, and revokes a copy", async () => {
    const first = await pair();
    const second: TokenPair = await (
      await refreshWith(first.refresh_token)
    ).json();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(
      await verifyAccessToken(db, env, second.access_token)
    ).not.toBeNull();

    // Two refreshes at once: the second, a moment later, still works.
    const retry = await refreshWith(first.refresh_token);
    expect(retry.status).toBe(200);

    // Past the grace period, a spent token is a copy: the grant goes.
    await db`
      update mcp_refresh_tokens
      set used_at = now() - make_interval(secs => ${REUSE_GRACE_SECONDS + 1})
      where used_at is not null
    `;
    expect(await (await refreshWith(first.refresh_token)).json()).toEqual({
      error: "invalid_grant",
    });
    expect(await verifyAccessToken(db, env, second.access_token)).toBeNull();
    expect(await (await refreshWith(second.refresh_token)).json()).toEqual({
      error: "invalid_grant",
    });
  });

  it("revokes a grant whose refresh token another client presents", async () => {
    const tokens = await pair();
    expect(
      await (
        await refreshWith(tokens.refresh_token, "https://other.example/client")
      ).json()
    ).toEqual({ error: "invalid_grant" });
    expect(await verifyAccessToken(db, env, tokens.access_token)).toBeNull();
  });

  it("cuts off a member taken off the allowlist", async () => {
    const tokens = await pair();
    const narrowed = mcpEnv({
      ...SETTINGS,
      ALLOWED_EMAILS: "bob@example.com",
    } as NodeJS.ProcessEnv)!;
    expect(
      await verifyAccessToken(db, narrowed, tokens.access_token)
    ).toBeNull();
    const refused = await token(
      narrowed,
      form("https://slide.example.org/oauth/token", {
        grant_type: "refresh_token",
        client_id: CLIENT,
        refresh_token: tokens.refresh_token,
      }),
      db
    );
    expect(await refused.json()).toEqual({ error: "invalid_grant" });
    // And the grant is gone even if the address comes back.
    expect(await verifyAccessToken(db, env, tokens.access_token)).toBeNull();
  });

  it("refuses forged, expired and other-purpose access tokens", async () => {
    const tokens = await pair();
    const [body, mac] = tokens.access_token.split(".");
    expect(await verifyAccessToken(db, env, `${body}.${mac}x`)).toBeNull();
    const consentToken = consent();
    expect(await verifyAccessToken(db, env, consentToken)).toBeNull();
    const family = (
      await db<
        { family: string }[]
      >`select family from mcp_refresh_tokens limit 1`
    )[0].family;
    const expired = sign(
      env,
      "access",
      { s: "alice-sub", f: family, c: CLIENT },
      60,
      Date.now() - 120_000
    );
    expect(await verifyAccessToken(db, env, expired)).toBeNull();
  });
});
