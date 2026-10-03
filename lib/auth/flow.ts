// Sign-in with Keycloak: authorization code flow with PKCE, state and nonce.
// Each step takes the request and returns the response, so the route
// handlers in app/auth/ stay one line and tests can drive the whole flow.
import { NextResponse, type NextRequest } from "next/server";
import * as client from "openid-client";

import { callbackUrl, oidc, type AuthEnv } from "./config";
import { safeNext } from "./redirect";
import { seal, unseal } from "./seal";
import {
  cookieOptions,
  readSession,
  SESSION_COOKIE,
  SESSION_SECONDS,
  sealSession,
  type SessionUser,
} from "./session";

/** Holds the PKCE verifier, state and nonce between login and callback. */
export const SIGN_IN_COOKIE = "slide_sign_in";
const SIGN_IN_SECONDS = 10 * 60;

type SignIn = { v: string; s: string; n: string; next: string };

function page(status: number, title: string, body: string): NextResponse {
  const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;margin:4rem auto;max-width:32rem;padding:0 1rem"><h1 style="font-size:1.5rem">${title}</h1><p>${body}</p><p><a href="/auth/login">重新登入</a></p></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** GET /auth/login?next=/path: sends the member to Keycloak. */
export async function startSignIn(
  request: NextRequest,
  env: AuthEnv
): Promise<NextResponse> {
  let configuration: client.Configuration;
  try {
    configuration = await oidc(env);
  } catch (error) {
    console.error("auth: discovery failed", error);
    return page(503, "暫時無法登入", "登入服務沒有回應，請稍後再試。");
  }
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const next = safeNext(request.nextUrl.searchParams.get("next"));

  const target = client.buildAuthorizationUrl(configuration, {
    redirect_uri: callbackUrl(env).href,
    scope: "openid profile email",
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });
  const response = NextResponse.redirect(target);
  response.cookies.set(
    SIGN_IN_COOKIE,
    await seal(
      { v: verifier, s: state, n: nonce, next } satisfies SignIn,
      env.secret,
      SIGN_IN_SECONDS
    ),
    cookieOptions(env, "/auth", SIGN_IN_SECONDS)
  );
  return response;
}

/**
 * GET /auth/callback: exchanges the code, checks state, nonce and PKCE,
 * records the member, and sets the session cookie.
 */
export async function finishSignIn(
  request: NextRequest,
  env: AuthEnv,
  onSignIn: (user: SessionUser) => Promise<void>
): Promise<NextResponse> {
  const sealed = request.cookies.get(SIGN_IN_COOKIE)?.value;
  const signIn = sealed ? await unseal<SignIn>(sealed, env.secret) : null;
  if (!signIn) {
    return page(400, "登入逾時", "這次登入已經過期，或瀏覽器擋掉了 cookie。");
  }

  let user: SessionUser;
  let idToken: string | undefined;
  try {
    const configuration = await oidc(env);
    // The URL Keycloak redirected to, rebuilt on APP_URL: behind a reverse
    // proxy the request URL carries the internal host instead.
    const current = callbackUrl(env);
    current.search = request.nextUrl.search;
    const tokens = await client.authorizationCodeGrant(configuration, current, {
      pkceCodeVerifier: signIn.v,
      expectedState: signIn.s,
      expectedNonce: signIn.n,
      idTokenExpected: true,
    });
    const claims = tokens.claims()!;
    user = {
      sub: claims.sub,
      name: String(claims.name ?? claims.preferred_username ?? ""),
      email: String(claims.email ?? ""),
    };
    idToken = tokens.id_token;
  } catch (error) {
    console.error("auth: callback refused", error);
    return page(400, "登入失敗", "登入沒有完成，請再試一次。");
  }

  await onSignIn(user);
  const response = NextResponse.redirect(new URL(signIn.next, env.appUrl));
  response.cookies.set(
    SESSION_COOKIE,
    await sealSession({ ...user, idToken }, env.secret),
    cookieOptions(env, "/", SESSION_SECONDS)
  );
  response.cookies.set(SIGN_IN_COOKIE, "", cookieOptions(env, "/auth", 0));
  return response;
}

/**
 * POST /auth/logout: clears the session and ends the Keycloak session too,
 * then Keycloak sends the member back to APP_URL.
 */
export async function signOut(
  request: NextRequest,
  env: AuthEnv
): Promise<NextResponse> {
  const session = await readSession(request, env);
  let target: URL = env.appUrl;
  try {
    target = client.buildEndSessionUrl(await oidc(env), {
      post_logout_redirect_uri: env.appUrl.href,
      ...(session?.idToken
        ? { id_token_hint: session.idToken }
        : { client_id: env.clientId }),
    });
  } catch (error) {
    console.error("auth: no end-session endpoint", error);
  }
  const response = NextResponse.redirect(target, 303);
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(env, "/", 0));
  return response;
}
