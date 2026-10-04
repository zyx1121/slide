// The OAuth front for MCP clients. Keycloak is the real authorization
// server, but MCP clients cannot register there (Keycloak would keep one
// client per workstation), so this app advertises itself as the
// authorization server and relays to one shared public Keycloak client:
//
//   1. GET /oauth/authorize checks the MCP client and shows a consent page.
//   2. POST /oauth/approve (same origin) sets a cookie bound to the browser
//      and sends it to Keycloak with the shared client, the client's PKCE
//      challenge, and a signed state that carries the client's request.
//   3. GET /oauth/callback checks the state and the cookie, wraps
//      Keycloak's code in a signed envelope bound to the client and its
//      redirect, and sends the browser back to the client.
//   4. POST /oauth/token checks the envelope against the request and
//      relays to Keycloak, which verifies PKCE and issues its own token.
//
// Nothing is stored: every step carries what the next needs, signed. The
// access token an MCP client holds is Keycloak's JWT; /mcp verifies it.
// After transcribe.winlab.tw's proxy (its ADR 0012).
import { createHmac, timingSafeEqual } from "node:crypto";

/** What the MCP endpoint and its OAuth front need; null turns MCP off. */
export type McpEnv = {
  appUrl: URL;
  issuer: URL;
  /** The shared public Keycloak client MCP sign-ins use. */
  clientId: string;
  /** The audience the access token must carry. */
  audience: string;
  /** Signs the state, the code envelope and the cookie. */
  secret: string;
};

/** Reads the MCP settings; MCP stays off until MCP_CLIENT_ID is set. */
export function mcpEnv(env: NodeJS.ProcessEnv = process.env): McpEnv | null {
  const clientId = env.MCP_CLIENT_ID;
  if (!clientId || !env.APP_URL || !env.KEYCLOAK_ISSUER) return null;
  const secret = env.SESSION_SECRET ?? "";
  if (secret.length < 32) return null;
  return {
    appUrl: new URL(env.APP_URL),
    issuer: new URL(env.KEYCLOAK_ISSUER),
    clientId,
    audience: env.MCP_AUDIENCE || clientId,
    secret,
  };
}

/** The resource MCP clients ask for: the endpoint itself. */
export const resourceUrl = (env: McpEnv) => new URL("/mcp", env.appUrl).href;
export const issuerUrl = (env: McpEnv) =>
  env.appUrl.origin + env.appUrl.pathname.replace(/\/$/, "");
export const callbackUrl = (env: McpEnv) =>
  new URL("/oauth/callback", env.appUrl).href;
export const keycloakUrl = (env: McpEnv, path: "auth" | "token" | "certs") =>
  `${env.issuer.href.replace(/\/$/, "")}/protocol/openid-connect/${path}`;

/** Scopes a client may ask for; anything else is dropped. */
export const SCOPES = ["openid", "profile", "email", "offline_access"];

export function scopeFor(requested: string | null): string {
  const asked = new Set((requested ?? "").split(/\s+/).filter(Boolean));
  asked.add("openid");
  return SCOPES.filter((scope) => asked.has(scope)).join(" ");
}

// ---------------------------------------------------------------- signing

/** A key for one purpose, so a value signed for one step fits no other. */
function key(env: McpEnv, purpose: string): Buffer {
  return createHmac("sha256", env.secret)
    .update(`slide-mcp:${purpose}`)
    .digest();
}

/** A value signed for a purpose, valid for `seconds`. */
export function sign(
  env: McpEnv,
  purpose: string,
  value: object,
  seconds: number,
  now = Date.now()
): string {
  const body = Buffer.from(
    JSON.stringify({ ...value, exp: Math.floor(now / 1000) + seconds })
  ).toString("base64url");
  const mac = createHmac("sha256", key(env, purpose))
    .update(body)
    .digest("base64url");
  return `${body}.${mac}`;
}

/** The value of a signed token, or null when forged, for another purpose or expired. */
export function unsign<T>(
  env: McpEnv,
  purpose: string,
  token: string | null | undefined,
  now = Date.now()
): T | null {
  if (!token || token.length > 8192) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const want = createHmac("sha256", key(env, purpose)).update(body).digest();
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(mac)) {
    return null;
  }
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      exp?: number;
    };
    if (typeof value.exp !== "number" || value.exp * 1000 < now) return null;
    return value as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- forms

/** The most a form posted to /oauth/token or /oauth/approve may hold, in bytes. */
export const FORM_LIMIT = 16 * 1024;

/**
 * A posted form, read no further than `limit` bytes: anyone may post to
 * these endpoints, so a body is never buffered whole before it is judged.
 * Real ones hold a wrapped code, a PKCE verifier or a refresh token.
 */
export async function readForm(
  request: Request,
  limit = FORM_LIMIT
): Promise<{ ok: true; form: FormData } | { ok: false; status: 400 | 413 }> {
  if (Number(request.headers.get("content-length")) > limit) {
    return { ok: false, status: 413 };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  }
  const form = await new Response(Buffer.concat(chunks), {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  })
    .formData()
    .catch(() => null);
  return form ? { ok: true, form } : { ok: false, status: 400 };
}

// ---------------------------------------------------------------- clients

/**
 * MCP clients this app knows by their Client ID Metadata Document: the two
 * Anthropic documents, read once and kept here, so nothing is ever fetched
 * on a client's say-so. Any other client is unverified and may use only a
 * loopback redirect, which keeps its code on the member's own machine.
 */
export const KNOWN_CLIENTS: Record<
  string,
  { name: string; redirects: string[] }
> = {
  "https://claude.ai/oauth/mcp-oauth-client-metadata": {
    name: "Claude",
    redirects: ["https://claude.ai/api/mcp/auth_callback"],
  },
  "https://claude.ai/oauth/claude-code-client-metadata": {
    name: "Claude Code",
    redirects: ["http://localhost/callback", "http://127.0.0.1/callback"],
  },
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A redirect URI as one canonical string, or null when it is not one we accept. */
export function parseRedirect(raw: string | null): URL | null {
  if (!raw || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash) return null;
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url;
  return null;
}

const isLoopback = (url: URL) =>
  url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);

/** A loopback redirect without its port, which RFC 8252 lets clients pick. */
const withoutPort = (url: URL) =>
  `${url.protocol}//${url.hostname}${url.pathname}${url.search}`;

export type ClientCheck =
  { ok: true; name: string; verified: boolean } | { ok: false; error: string };

/** Whether a client may receive codes at a redirect URI, and what to call it. */
export function checkClient(
  clientId: string | null,
  redirect: URL | null
): ClientCheck {
  if (!clientId || clientId.length > 512) {
    return { ok: false, error: "client_id is missing" };
  }
  if (!redirect) return { ok: false, error: "redirect_uri is not acceptable" };
  const known = KNOWN_CLIENTS[clientId];
  if (known) {
    const listed = known.redirects.some((listedUri) => {
      const want = new URL(listedUri);
      return isLoopback(want)
        ? isLoopback(redirect) && withoutPort(redirect) === withoutPort(want)
        : redirect.href === want.href;
    });
    if (!listed) {
      return {
        ok: false,
        error: "redirect_uri is not registered for this client",
      };
    }
    // A loopback redirect is any local program; only an https one is the
    // client's own.
    return isLoopback(redirect)
      ? { ok: true, name: known.name, verified: false }
      : { ok: true, name: known.name, verified: true };
  }
  if (!isLoopback(redirect)) {
    return {
      ok: false,
      error: "an unlisted client may only use a loopback redirect_uri",
    };
  }
  return { ok: true, name: "", verified: false };
}

/** The request an MCP client makes to /oauth/authorize, checked. */
export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  name: string;
  verified: boolean;
};

export function readAuthorize(
  env: McpEnv,
  params: URLSearchParams
):
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; error: string; redirect?: string } {
  const redirect = parseRedirect(params.get("redirect_uri"));
  const clientId = params.get("client_id");
  const client = checkClient(clientId, redirect);
  // Without a client and redirect we trust, errors are shown, not sent.
  if (!client.ok) return { ok: false, error: client.error };
  const state = params.get("state") ?? "";
  const fail = (error: string) => {
    const back = new URL(redirect!.href);
    back.searchParams.set("error", error);
    if (state) back.searchParams.set("state", state);
    back.searchParams.set("iss", issuerUrl(env));
    return { ok: false as const, error, redirect: back.href };
  };
  if (params.get("response_type") !== "code")
    return fail("unsupported_response_type");
  const challenge = params.get("code_challenge") ?? "";
  if (
    params.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)
  ) {
    return fail("invalid_request");
  }
  const resource = params.get("resource");
  if (resource && resource !== resourceUrl(env)) return fail("invalid_target");
  if (state.length > 1024) return fail("invalid_request");
  return {
    ok: true,
    request: {
      clientId: clientId!,
      redirectUri: redirect!.href,
      state,
      codeChallenge: challenge,
      scope: scopeFor(params.get("scope")),
      name: client.name,
      verified: client.verified,
    },
  };
}

/** How long a sign-in may take, from the consent page to the token, in s. */
export const FLOW_SECONDS = 600;
/** How long a wrapped code is good for, in s. */
export const CODE_SECONDS = 300;

/** Where the approving browser goes: Keycloak, with the shared client. */
export function keycloakAuthorize(
  env: McpEnv,
  request: AuthorizeRequest,
  nonce: string
): string {
  const url = new URL(keycloakUrl(env, "auth"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", callbackUrl(env));
  url.searchParams.set("scope", request.scope);
  url.searchParams.set("code_challenge", request.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set(
    "state",
    sign(env, "state", { r: request, n: nonce }, FLOW_SECONDS)
  );
  return url.href;
}
