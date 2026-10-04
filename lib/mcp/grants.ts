// Server only: what the MCP authorization server stores. Codes and refresh
// tokens are kept by their sha256 only, so the database never holds a value
// a client could present.
//
// A grant is a family of refresh tokens, one member and one client. Each
// refresh spends its token and issues the next (rotation). A spent token
// presented again within REUSE_GRACE_SECONDS gets a new pair too, since a
// client may refresh twice at once; later, it means the token was copied,
// and the whole family is revoked. An access token names its family, so
// revoking the family cuts the client off at once.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type postgres from "postgres";

import { isAllowed } from "../auth/config";
import { type McpEnv, sign, unsign } from "./oauth";

type Db = postgres.Sql | postgres.TransactionSql;

/** How long a code is good for, in s. */
export const CODE_SECONDS = 120;
/** How long an access token is good for, in s. */
export const ACCESS_SECONDS = 60 * 60;
/** How long a refresh token is good for, in s; each refresh starts it over. */
export const REFRESH_SECONDS = 30 * 24 * 60 * 60;
/** How long a spent refresh token may still be presented, in s. */
export const REUSE_GRACE_SECONDS = 60;

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");

/** Whether the member behind `sub` may still use the app. */
async function memberAllowed(
  db: Db,
  env: McpEnv,
  sub: string
): Promise<boolean> {
  const [user] = await db<{ email: string }[]>`
    select email from users where sub = ${sub}
  `;
  return !!user && isAllowed(env.auth, user.email);
}

/** A one-time code for a client the member just approved. */
export async function createCode(
  db: Db,
  grant: {
    sub: string;
    clientId: string;
    redirectUri: string;
    challenge: string;
    scope: string;
  }
): Promise<string> {
  const code = randomToken();
  // Expired codes and the refresh tokens of grants nobody uses any more go
  // here, now and then, whichever grant they belong to.
  await db`
    delete from mcp_codes where expires_at < now()
  `;
  await db`
    delete from mcp_refresh_tokens where expires_at < now()
  `;
  await db`
    insert into mcp_codes
      (hash, sub, client_id, redirect_uri, challenge, scope, expires_at)
    values (${hash(code)}, ${grant.sub}, ${grant.clientId}, ${grant.redirectUri},
      ${grant.challenge}, ${grant.scope},
      now() + make_interval(secs => ${CODE_SECONDS}))
  `;
  return code;
}

export type TokenPair = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

type Refusal = { error: "invalid_grant" };
const REFUSED: Refusal = { error: "invalid_grant" };

/** A new refresh token in a family, and an access token naming it. */
async function issue(
  db: Db,
  env: McpEnv,
  grant: { family: string; sub: string; clientId: string; scope: string }
): Promise<TokenPair> {
  const refresh = randomToken();
  await db`
    insert into mcp_refresh_tokens
      (hash, family, sub, client_id, scope, expires_at)
    values (${hash(refresh)}, ${grant.family}, ${grant.sub}, ${grant.clientId},
      ${grant.scope}, now() + make_interval(secs => ${REFRESH_SECONDS}))
  `;
  return {
    access_token: sign(
      env,
      "access",
      { s: grant.sub, f: grant.family, c: grant.clientId },
      ACCESS_SECONDS
    ),
    token_type: "Bearer",
    expires_in: ACCESS_SECONDS,
    refresh_token: refresh,
    scope: grant.scope,
  };
}

const sameText = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Trades a code for the first pair of a new grant. The code is spent
 * whatever the outcome, so a code that met a wrong verifier cannot be tried
 * again.
 */
export async function redeemCode(
  db: postgres.Sql,
  env: McpEnv,
  presented: {
    code: string;
    clientId: string;
    redirectUri: string;
    verifier: string;
  }
): Promise<TokenPair | Refusal> {
  return db.begin(async (tx) => {
    const [row] = await tx<
      {
        sub: string;
        client_id: string;
        redirect_uri: string;
        challenge: string;
        scope: string;
        live: boolean;
      }[]
    >`
      delete from mcp_codes where hash = ${hash(presented.code)}
      returning sub, client_id, redirect_uri, challenge, scope,
        expires_at > now() as live
    `;
    if (!row || !row.live) return REFUSED;
    const challenge = createHash("sha256")
      .update(presented.verifier)
      .digest("base64url");
    if (
      row.client_id !== presented.clientId ||
      row.redirect_uri !== presented.redirectUri ||
      !sameText(challenge, row.challenge)
    ) {
      return REFUSED;
    }
    if (!(await memberAllowed(tx, env, row.sub))) return REFUSED;
    return issue(tx, env, {
      family: randomToken(),
      sub: row.sub,
      clientId: row.client_id,
      scope: row.scope,
    });
  });
}

/** Trades a refresh token for the next pair; see the top of this file. */
export async function refresh(
  db: postgres.Sql,
  env: McpEnv,
  presented: { token: string; clientId: string }
): Promise<TokenPair | Refusal> {
  return db.begin(async (tx) => {
    const [row] = await tx<
      {
        family: string;
        sub: string;
        client_id: string;
        scope: string;
        live: boolean;
        spent: boolean;
        in_grace: boolean;
      }[]
    >`
      select family, sub, client_id, scope,
        expires_at > now() as live,
        used_at is not null as spent,
        coalesce(used_at > now() - make_interval(secs => ${REUSE_GRACE_SECONDS}), false) as in_grace
      from mcp_refresh_tokens
      where hash = ${hash(presented.token)}
      for update
    `;
    if (!row || !row.live) return REFUSED;
    const revoke = async () => {
      await tx`delete from mcp_refresh_tokens where family = ${row.family}`;
      return REFUSED;
    };
    if (row.spent && !row.in_grace) return revoke();
    if (row.client_id !== presented.clientId) return revoke();
    if (!(await memberAllowed(tx, env, row.sub))) return revoke();
    if (!row.spent) {
      await tx`
        update mcp_refresh_tokens set used_at = now()
        where hash = ${hash(presented.token)}
      `;
    }
    // Spent tokens are kept for a day, long enough to tell a copy from a
    // retry; then they go.
    await tx`
      delete from mcp_refresh_tokens
      where family = ${row.family}
        and (expires_at < now() or used_at < now() - interval '1 day')
    `;
    return issue(tx, env, {
      family: row.family,
      sub: row.sub,
      clientId: row.client_id,
      scope: row.scope,
    });
  });
}

export type McpUser = {
  sub: string;
  clientId: string;
  expiresAt: number;
};

/**
 * The member an access token acts for, or null: a token that is forged or
 * expired, whose grant was revoked, or whose member left the allowlist.
 */
export async function verifyAccessToken(
  db: Db,
  env: McpEnv,
  token: string
): Promise<McpUser | null> {
  const value = unsign<{ s: string; f: string; c: string; exp: number }>(
    env,
    "access",
    token
  );
  if (
    !value ||
    typeof value.s !== "string" ||
    typeof value.f !== "string" ||
    typeof value.c !== "string"
  ) {
    return null;
  }
  const [row] = await db<{ email: string }[]>`
    select u.email from users u
    where u.sub = ${value.s}
      and exists (
        select 1 from mcp_refresh_tokens t
        where t.family = ${value.f} and t.sub = u.sub and t.expires_at > now()
      )
  `;
  if (!row || !isAllowed(env.auth, row.email)) return null;
  return { sub: value.s, clientId: value.c, expiresAt: value.exp };
}

/** The bearer token of a request, or null. */
export function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header);
  return match ? match[1] : null;
}
