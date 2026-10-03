// Discovery documents MCP clients read before signing in: the protected
// resource (RFC 9728) names this app as its authorization server, and the
// authorization server metadata (RFC 8414) names the OAuth front's
// endpoints.
import { issuerUrl, type McpEnv, resourceUrl, SCOPES } from "./oauth";

export const protectedResourceUrl = (env: McpEnv) =>
  new URL("/.well-known/oauth-protected-resource/mcp", env.appUrl).href;

export function protectedResource(env: McpEnv) {
  return {
    resource: resourceUrl(env),
    authorization_servers: [issuerUrl(env)],
    bearer_methods_supported: ["header"],
    scopes_supported: SCOPES.filter((scope) => scope !== "offline_access"),
    resource_name: "slide.winlab.tw",
  };
}

export function authorizationServer(env: McpEnv) {
  const at = (path: string) => new URL(path, env.appUrl).href;
  return {
    issuer: issuerUrl(env),
    authorization_endpoint: at("/oauth/authorize"),
    token_endpoint: at("/oauth/token"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
    // Known clients are named by their metadata document's URL; there is no
    // registration endpoint.
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** A JSON document, or 404 while MCP is off. */
export function documentResponse(body: object | null): Response {
  if (!body) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(body, {
    headers: {
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
