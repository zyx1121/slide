// Checks the bearer token an MCP client sends: Keycloak's own access token,
// signed by the realm's keys, issued to the shared MCP client and meant for
// this app. The member it names is who the tools act for.
import {
  createRemoteJWKSet,
  errors,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";

import { keycloakUrl, type McpEnv } from "./oauth";

export type McpUser = {
  sub: string;
  name: string;
  email: string;
  expiresAt: number;
};

/** The realm's keys could not be fetched: the token was not judged. */
export class KeysUnavailableError extends Error {}

const keySets = new Map<string, JWTVerifyGetKey>();

function keysFor(env: McpEnv): JWTVerifyGetKey {
  const url = keycloakUrl(env, "certs");
  let keys = keySets.get(url);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(url), { timeoutDuration: 5000 });
    keySets.set(url, keys);
  }
  return keys;
}

/**
 * The member a bearer token is for, or null when it is not a valid token
 * for this app. Throws KeysUnavailableError when the realm's keys cannot be
 * fetched, so the caller answers 503 rather than claiming the token is bad.
 */
export async function verifyAccessToken(
  env: McpEnv,
  token: string,
  keys: JWTVerifyGetKey = keysFor(env)
): Promise<McpUser | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: env.issuer.href.replace(/\/$/, ""),
      audience: env.audience,
      algorithms: ["RS256", "ES256", "PS256"],
      requiredClaims: ["exp", "iat", "sub"],
      clockTolerance: 10,
    });
    // Issued to the MCP client, not to the web app or another client of the
    // realm that happens to share the audience; and an access token, not
    // the ID token Keycloak issues alongside it.
    if (payload.azp !== env.clientId) return null;
    if (payload.typ !== undefined && payload.typ !== "Bearer") return null;
    const claim = (name: string) =>
      typeof payload[name] === "string" ? (payload[name] as string) : "";
    return {
      sub: payload.sub!,
      name: claim("name") || claim("preferred_username"),
      email: claim("email"),
      expiresAt: payload.exp!,
    };
  } catch (error) {
    // The realm's keys could not be had (a timeout, a network error, or a
    // key set endpoint that answers other than 200): not the token's fault.
    if (
      error instanceof errors.JWKSTimeout ||
      (error instanceof errors.JOSEError &&
        /JSON Web Key Set/.test(error.message) &&
        !(error instanceof errors.JWKSNoMatchingKey)) ||
      (error instanceof Error &&
        /fetch|network|ECONN|ENOTFOUND/i.test(error.message) &&
        !(error instanceof errors.JOSEError))
    ) {
      throw new KeysUnavailableError(String(error));
    }
    return null;
  }
}

/** The bearer token of a request, or null. */
export function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header);
  return match ? match[1] : null;
}
