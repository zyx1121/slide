import * as client from "openid-client";

export type AuthEnv = {
  /** The public URL members open; the provider redirects back to it. */
  appUrl: URL;
  /** The OpenID Connect provider, such as https://accounts.google.com. */
  issuer: URL;
  clientId: string;
  clientSecret: string;
  /** Encrypts the session and sign-in cookies. */
  secret: string;
  /** The verified email addresses that may sign in, lowercased. */
  allowed: ReadonlySet<string>;
};

const KEYS = [
  "APP_URL",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "SESSION_SECRET",
  "ALLOWED_EMAILS",
] as const;

/** An email address as the allowlist compares it. */
export const normalEmail = (email: string) => email.trim().toLowerCase();

/** Reads the sign-in settings; throws when one is missing, so auth fails closed. */
export function authEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  const missing = KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`set ${missing.join(", ")} (see .env.example)`);
  }
  if (env.SESSION_SECRET!.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  const allowed = new Set(
    env.ALLOWED_EMAILS!.split(",").map(normalEmail).filter(Boolean)
  );
  if (allowed.size === 0) {
    throw new Error("ALLOWED_EMAILS must list at least one email address");
  }
  return {
    appUrl: new URL(env.APP_URL!),
    issuer: new URL(env.OIDC_ISSUER!),
    clientId: env.OIDC_CLIENT_ID!,
    clientSecret: env.OIDC_CLIENT_SECRET!,
    secret: env.SESSION_SECRET!,
    allowed,
  };
}

/** Whether a session's email may still use the app: the allowlist can shrink. */
export const isAllowed = (env: AuthEnv, email: string) =>
  env.allowed.has(normalEmail(email));

export function callbackUrl(env: AuthEnv): URL {
  return new URL("/auth/callback", env.appUrl);
}

const discovered = new Map<string, Promise<client.Configuration>>();

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The issuer's OIDC configuration, fetched once per process. A failed fetch
 * is forgotten, so the next sign-in tries again. Plain http is accepted only
 * for an issuer on this machine, which is what the tests run; anywhere else
 * openid-client refuses it. ID token signatures are verified against the
 * issuer's keys, on top of the TLS-protected token response.
 */
export function oidc(env: AuthEnv): Promise<client.Configuration> {
  const key = `${env.issuer.href} ${env.clientId}`;
  let configuration = discovered.get(key);
  if (!configuration) {
    const local =
      env.issuer.protocol === "http:" && LOOPBACK.has(env.issuer.hostname);
    configuration = client
      .discovery(
        env.issuer,
        env.clientId,
        env.clientSecret,
        undefined,
        local ? { execute: [client.allowInsecureRequests] } : undefined
      )
      .then((found) => {
        client.enableNonRepudiationChecks(found);
        return found;
      });
    configuration.catch(() => discovered.delete(key));
    discovered.set(key, configuration);
  }
  return configuration;
}
