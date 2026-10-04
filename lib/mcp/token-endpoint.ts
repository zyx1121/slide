// POST /oauth/token: relays a client's code or refresh token to Keycloak
// with the shared client. A wrapped code must come back from the client it
// was issued to, with the same redirect URI; Keycloak checks PKCE.
import {
  callbackUrl,
  keycloakUrl,
  type McpEnv,
  readForm,
  unsign,
} from "./oauth";

const oauthError = (error: string, status = 400) =>
  Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } }
  );

export async function token(
  env: McpEnv,
  request: Request,
  send: typeof fetch = fetch
): Promise<Response> {
  const read = await readForm(request);
  if (!read.ok) return oauthError("invalid_request", read.status);
  const field = (name: string) => read.form.get(name)?.toString() ?? "";
  const grant = field("grant_type");
  const body = new URLSearchParams({ client_id: env.clientId });

  if (grant === "authorization_code") {
    const code = unsign<{ k: string; c: string; u: string }>(
      env,
      "code",
      field("code")
    );
    if (
      !code ||
      code.c !== field("client_id") ||
      code.u !== field("redirect_uri")
    ) {
      return oauthError("invalid_grant");
    }
    const verifier = field("code_verifier");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
      return oauthError("invalid_request");
    body.set("grant_type", "authorization_code");
    body.set("code", code.k);
    body.set("redirect_uri", callbackUrl(env));
    body.set("code_verifier", verifier);
  } else if (grant === "refresh_token") {
    const refresh = field("refresh_token");
    if (!refresh) return oauthError("invalid_request");
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refresh);
  } else {
    return oauthError("unsupported_grant_type");
  }

  let upstream: Response;
  try {
    upstream = await send(keycloakUrl(env, "token"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return oauthError("temporarily_unavailable", 503);
  }
  // Keycloak's answer, as it is: the client gets Keycloak's own tokens.
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
