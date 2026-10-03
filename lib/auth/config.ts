import * as client from "openid-client";

export type AuthEnv = {
  /** The public URL members open; Keycloak redirects back to it. */
  appUrl: URL;
  issuer: URL;
  clientId: string;
  clientSecret: string;
  /** Encrypts the session and sign-in cookies. */
  secret: string;
};

const KEYS = [
  "APP_URL",
  "KEYCLOAK_ISSUER",
  "KEYCLOAK_CLIENT_ID",
  "KEYCLOAK_CLIENT_SECRET",
  "SESSION_SECRET",
] as const;

/** Reads the sign-in settings; throws when one is missing, so auth fails closed. */
export function authEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  const missing = KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`set ${missing.join(", ")} (see .env.example)`);
  }
  if (env.SESSION_SECRET!.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return {
    appUrl: new URL(env.APP_URL!),
    issuer: new URL(env.KEYCLOAK_ISSUER!),
    clientId: env.KEYCLOAK_CLIENT_ID!,
    clientSecret: env.KEYCLOAK_CLIENT_SECRET!,
    secret: env.SESSION_SECRET!,
  };
}

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
