import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { sql } from "@/lib/db";
import { protectedResourceUrl } from "@/lib/mcp/metadata";
import { mcpEnv } from "@/lib/mcp/oauth";
import { createServer } from "@/lib/mcp/server";
import {
  bearer,
  KeysUnavailableError,
  verifyAccessToken,
} from "@/lib/mcp/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * /mcp: the MCP endpoint (Streamable HTTP, stateless, JSON responses). Every
 * request carries a Keycloak access token for the shared MCP client; the
 * tools act as the member it names.
 */
async function handle(request: Request): Promise<Response> {
  const env = mcpEnv();
  if (!env)
    return Response.json({ error: "MCP is not set up" }, { status: 404 });

  // A page on another site may not drive the endpoint through a browser.
  const origin = request.headers.get("origin");
  if (origin && origin !== env.appUrl.origin) {
    return Response.json({ error: "forbidden origin" }, { status: 403 });
  }

  const challenge = (error?: string) =>
    new Response(JSON.stringify({ error: error ?? "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${protectedResourceUrl(env)}"${
          error ? `, error="${error}"` : ""
        }`,
      },
    });
  const token = bearer(request);
  if (!token) return challenge();
  let user;
  try {
    user = await verifyAccessToken(env, token);
  } catch (error) {
    if (!(error instanceof KeysUnavailableError)) throw error;
    return Response.json(
      { error: "cannot check the token now" },
      { status: 503, headers: { "retry-after": "10" } }
    );
  }
  if (!user) return challenge("invalid_token");

  const server = createServer({ db: sql, sub: user.sub });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, {
      authInfo: {
        token,
        clientId: env.clientId,
        scopes: [],
        expiresAt: user.expiresAt,
      },
    });
  } finally {
    await transport.close();
    await server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
