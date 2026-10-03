import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { authEnv, type AuthEnv } from "./config";
import { seal, unseal } from "./seal";

export const SESSION_SECONDS = 7 * 24 * 60 * 60;

/**
 * A cookie's name for this deployment. Over https it takes the __Host-
 * prefix: the browser then refuses a Domain attribute on it, so a page on a
 * sibling *.winlab.tw host cannot plant one (cookie tossing) to swap a
 * member's session or sign-in. Plain-http development cannot use the prefix.
 */
export function cookieName(
  env: AuthEnv,
  base: "slide_session" | "slide_sign_in"
): string {
  return env.appUrl.protocol === "https:" ? `__Host-${base}` : base;
}

export function sessionCookie(env: AuthEnv): string {
  return cookieName(env, "slide_session");
}

export type SessionUser = {
  /** Keycloak subject; every deck query is scoped to it. */
  sub: string;
  name: string;
  email: string;
};

type SessionPayload = {
  sub: string;
  name: string;
  email: string;
  idt?: string;
};

// A browser keeps a cookie of up to 4096 bytes; leave room for its name and
// attributes. The ID token only makes sign-out skip Keycloak's confirm page.
const MAX_COOKIE_VALUE = 3800;

export async function sealSession(
  user: SessionUser & { idToken?: string },
  secret: string
): Promise<string> {
  const payload: SessionPayload = {
    sub: user.sub,
    name: user.name,
    email: user.email,
  };
  if (user.idToken) {
    const withToken = await seal(
      { ...payload, idt: user.idToken },
      secret,
      SESSION_SECONDS
    );
    if (withToken.length <= MAX_COOKIE_VALUE) return withToken;
  }
  return seal(payload, secret, SESSION_SECONDS);
}

export async function unsealSession(
  token: string,
  secret: string
): Promise<(SessionUser & { idToken?: string }) | null> {
  const payload = await unseal<SessionPayload>(token, secret);
  if (!payload || typeof payload.sub !== "string" || !payload.sub) return null;
  return {
    sub: payload.sub,
    name: String(payload.name ?? ""),
    email: String(payload.email ?? ""),
    idToken: typeof payload.idt === "string" ? payload.idt : undefined,
  };
}

/** The session carried by a request, for proxy.ts and route handlers. */
export function readSession(request: NextRequest, env: AuthEnv) {
  const token = request.cookies.get(sessionCookie(env))?.value;
  return token ? unsealSession(token, env.secret) : Promise.resolve(null);
}

/** Host-only (no Domain), Path=/ and, over https, Secure: what __Host- requires. */
export function cookieOptions(env: AuthEnv, maxAge: number) {
  return {
    httpOnly: true,
    secure: env.appUrl.protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/** The signed-in member in a Server Component or Server Function, or null. */
export async function getSession(): Promise<SessionUser | null> {
  const env = authEnv();
  const token = (await cookies()).get(sessionCookie(env))?.value;
  if (!token) return null;
  const session = await unsealSession(token, env.secret);
  return session
    ? { sub: session.sub, name: session.name, email: session.email }
    : null;
}

/**
 * The signed-in member, or a redirect to sign-in. proxy.ts already gates
 * pages; this is the check every page and Server Function makes itself.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/auth/login");
  return user;
}
