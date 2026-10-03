// The browser steps of the MCP OAuth front: approving on the consent page,
// and coming back from Keycloak. See oauth.ts for the whole flow.
import { randomBytes, timingSafeEqual } from "node:crypto";

import {
  type AuthorizeRequest,
  CODE_SECONDS,
  FLOW_SECONDS,
  issuerUrl,
  keycloakAuthorize,
  type McpEnv,
  sign,
  unsign,
} from "./oauth";

/** The cookie that binds a sign-in to the browser that approved it. */
export function flowCookie(env: McpEnv): string {
  return env.appUrl.protocol === "https:"
    ? "__Host-slide_mcp_flow"
    : "slide_mcp_flow";
}

function cookieValue(request: Request, name: string): string | null {
  // Only spaces and tabs separate cookies; a name must match exactly.
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const pair = part.replace(/^[ \t]+|[ \t]+$/g, "");
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at) === name) return pair.slice(at + 1);
  }
  return null;
}

function setCookie(env: McpEnv, value: string, maxAge: number): string {
  const secure = env.appUrl.protocol === "https:" ? "; Secure" : "";
  // Lax, not Strict: the browser comes back from Keycloak on a top-level GET.
  return `${flowCookie(env)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const sameText = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Where the client's redirect goes with an error. */
function clientError(
  env: McpEnv,
  request: AuthorizeRequest,
  error: string
): string {
  const url = new URL(request.redirectUri);
  url.searchParams.set("error", error);
  if (request.state) url.searchParams.set("state", request.state);
  url.searchParams.set("iss", issuerUrl(env));
  return url.href;
}

const see = (location: string, cookie?: string) =>
  new Response(null, {
    status: 303,
    headers: {
      location,
      "cache-control": "no-store",
      ...(cookie ? { "set-cookie": cookie } : {}),
    },
  });

const page = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });

/**
 * POST /oauth/approve: the consent page's form. Only from this site's own
 * page; denying sends the client an error, allowing sends the browser to
 * Keycloak with a cookie that the callback checks.
 */
export async function approve(
  env: McpEnv,
  request: Request
): Promise<Response> {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // A browser names where a form came from; without either header, nothing
  // says it was this site's page.
  if (
    (!origin && !site) ||
    (origin && origin !== env.appUrl.origin) ||
    (site && site !== "same-origin")
  ) {
    return page(403, "Forbidden");
  }
  const form = await request.formData().catch(() => null);
  const tx = unsign<{ r: AuthorizeRequest }>(
    env,
    "consent",
    form?.get("tx")?.toString()
  );
  if (!tx) return page(400, "這個授權要求已過期，請回到應用程式重新連線。");
  if (form?.get("decision") !== "allow") {
    return see(clientError(env, tx.r, "access_denied"));
  }
  const nonce = randomBytes(24).toString("base64url");
  return see(
    keycloakAuthorize(env, tx.r, nonce),
    setCookie(env, nonce, FLOW_SECONDS)
  );
}

/**
 * GET /oauth/callback: Keycloak sends the browser back. The state must be
 * ours and the browser the one that approved; Keycloak's code goes to the
 * client wrapped in an envelope bound to that client and redirect.
 */
export function callback(env: McpEnv, request: Request): Response {
  const params = new URL(request.url).searchParams;
  const state = unsign<{ r: AuthorizeRequest; n: string }>(
    env,
    "state",
    params.get("state")
  );
  if (!state) return page(400, "這個授權要求已過期，請回到應用程式重新連線。");
  const cookie = cookieValue(request, flowCookie(env));
  if (!cookie || !sameText(cookie, state.n)) {
    return page(400, "請在剛剛按下「允許」的同一個瀏覽器完成登入。");
  }
  const clear = setCookie(env, "", 0);
  const error = params.get("error");
  const code = params.get("code");
  if (error || !code) {
    return see(
      clientError(
        env,
        state.r,
        error === "access_denied" ? "access_denied" : "server_error"
      ),
      clear
    );
  }
  const wrapped = sign(
    env,
    "code",
    { k: code, c: state.r.clientId, u: state.r.redirectUri },
    CODE_SECONDS
  );
  const back = new URL(state.r.redirectUri);
  back.searchParams.set("code", wrapped);
  if (state.r.state) back.searchParams.set("state", state.r.state);
  back.searchParams.set("iss", issuerUrl(env));
  return see(back.href, clear);
}
