// Sign-in with Keycloak: authorization code flow with PKCE, state and nonce.
// Each step takes the request and returns the response, so the route
// handlers in app/auth/ stay one line and tests can drive the whole flow.
import { NextResponse, type NextRequest } from "next/server";
import * as client from "openid-client";

import { callbackUrl, oidc, type AuthEnv } from "./config";
import { safeNext } from "./redirect";
import { seal, unseal } from "./seal";
import {
  cookieName,
  cookieOptions,
  readSession,
  SESSION_SECONDS,
  sealSession,
  sessionCookie,
  type SessionUser,
} from "./session";

/** Holds the PKCE verifier, state and nonce between login and callback. */
export function signInCookie(env: AuthEnv): string {
  return cookieName(env, "slide_sign_in");
}
const SIGN_IN_SECONDS = 10 * 60;

type SignIn = { v: string; s: string; n: string; next: string };

type Failure = "expired" | "failed" | "unavailable";

/** Sends the member to the sign-in error page (app/auth/error), inside the shell. */
function failure(env: AuthEnv, reason: Failure): NextResponse {
  const target = new URL("/auth/error", env.appUrl);
  target.searchParams.set("reason", reason);
  return NextResponse.redirect(target, 303);
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
    return failure(env, "unavailable");
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
    signInCookie(env),
    await seal(
      { v: verifier, s: state, n: nonce, next } satisfies SignIn,
      env.secret,
      SIGN_IN_SECONDS
    ),
    cookieOptions(env, SIGN_IN_SECONDS)
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
  const sealed = request.cookies.get(signInCookie(env))?.value;
  const signIn = sealed ? await unseal<SignIn>(sealed, env.secret) : null;
  if (!signIn) {
    return failure(env, "expired");
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
    return failure(env, "failed");
  }

  await onSignIn(user);
  const response = NextResponse.redirect(new URL(signIn.next, env.appUrl));
  response.cookies.set(
    sessionCookie(env),
    await sealSession({ ...user, idToken }, env.secret),
    cookieOptions(env, SESSION_SECONDS)
  );
  response.cookies.set(signInCookie(env), "", cookieOptions(env, 0));
  return response;
}

/**
 * POST /auth/logout: clears the session and ends the Keycloak session too,
 * then Keycloak sends the member back to APP_URL. A cross-site form cannot
 * sign a member out: it is refused, and a request without a session clears
 * nothing.
 */
export async function signOut(
  request: NextRequest,
  env: AuthEnv
): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin !== null && origin !== env.appUrl.origin)
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const session = await readSession(request, env);
  if (!session) return NextResponse.redirect(env.appUrl, 303);
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
  response.cookies.set(sessionCookie(env), "", cookieOptions(env, 0));
  return response;
}
