import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { authEnv, type AuthEnv } from "./config";
import { seal, unseal } from "./seal";

export const SESSION_COOKIE = "slide_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

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
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return token ? unsealSession(token, env.secret) : Promise.resolve(null);
}

export function cookieOptions(env: AuthEnv, path: string, maxAge: number) {
  return {
    httpOnly: true,
    secure: env.appUrl.protocol === "https:",
    sameSite: "lax" as const,
    path,
    maxAge,
  };
}

/** The signed-in member in a Server Component or Server Function, or null. */
export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await unsealSession(token, authEnv().secret);
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
