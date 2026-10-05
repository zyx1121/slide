import {
  type AuthInfo,
  createMcpHandler,
  isLegacyRequest,
  type McpServerFactory,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";

import { sql } from "@/lib/db";
import { bearer, verifyAccessToken } from "@/lib/mcp/grants";
import { protectedResourceUrl } from "@/lib/mcp/metadata";
import { mcpEnv } from "@/lib/mcp/oauth";
import { createServer, MCP_IMPORT_MAX_BYTES } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

/** The largest request /mcp reads: a base64 .pptx at its cap, and room. */
// Base64 is 4/3 of the file; 3 % more covers line breaks every 76
// characters, as the base64 command writes them, and the JSON-RPC around it.
const MCP_BODY_MAX_BYTES = Math.ceil(((MCP_IMPORT_MAX_BYTES * 4) / 3) * 1.03);
export const runtime = "nodejs";

/**
 * /mcp: the MCP endpoint (Streamable HTTP, stateless, JSON responses),
 * speaking protocol 2026-07-28 and, to clients that open with initialize,
 * the 2025 revisions. Every request carries an access token Slide issued
 * (lib/mcp/grants.ts); the tools act as the member it names, while the
 * grant stands and the member stays on the allowlist.
 */
async function handle(request: Request): Promise<Response> {
  const env = mcpEnv();
  if (!env)
    return Response.json({ error: "sign-in is not set up" }, { status: 404 });

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
  const user = await verifyAccessToken(sql, env, token);
  if (!user) return challenge("invalid_token");

  // Stateless, so there is no stream to hold open and no session to end. A
  // GET answered with a stream that closes at once makes clients reconnect
  // every second, refreshing their token each time; 405 tells them there is
  // no stream here.
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }

  const authInfo: AuthInfo = {
    token,
    clientId: user.clientId,
    scopes: ["decks"],
    expiresAt: user.expiresAt,
    extra: { sub: user.sub },
  };
  if (
    await isLegacyRequest(request, undefined, {
      maxRequestBodySize: MCP_BODY_MAX_BYTES,
    })
  ) {
    return legacy(request, authInfo);
  }
  // Slide sends no notifications, so it opens no subscription stream: one
  // would stay open past the token's life and share the handler's cap.
  const call = await request
    .clone()
    .json()
    .catch(() => null);
  if (call?.method === "subscriptions/listen") {
    return Response.json({
      jsonrpc: "2.0",
      id: call.id ?? null,
      error: { code: -32601, message: "Method not found" },
    });
  }
  return modern.fetch(request, { authInfo });
}

/** A server acting as the member handle() put in the request's authInfo. */
const serverFor: McpServerFactory = ({ authInfo }) => {
  const sub = authInfo?.extra?.sub;
  // handle() always passes the member; never serve a request without one.
  if (typeof sub !== "string" || !sub) throw new Error("no member");
  return createServer({ db: sql, sub });
};

/**
 * Protocol 2026-07-28: every request carries its own envelope, no
 * handshake. JSON responses only, so there is no stream to hold open.
 */
const modern = createMcpHandler(serverFor, {
  legacy: "reject",
  responseMode: "json",
  // Room for the largest file a tool takes (import_deck), in base64, and
  // the JSON-RPC around it; the SDK's own cap is 4 MiB.
  maxRequestBodySize: MCP_BODY_MAX_BYTES,
});

/**
 * The 2025 revisions, for clients that open with initialize: served
 * statelessly, one server per request, with JSON responses (the SDK's own
 * fallback would answer with a stream).
 */
async function legacy(request: Request, authInfo: AuthInfo): Promise<Response> {
  const server = await serverFor({ era: "legacy", authInfo });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MCP_BODY_MAX_BYTES,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { authInfo });
  } finally {
    await transport.close();
    await server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
