import { callback } from "@/lib/mcp/flow";
import { mcpEnv } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

/** GET /oauth/callback: back from Keycloak, on to the MCP client. */
export function GET(request: Request) {
  const env = mcpEnv();
  if (!env) return Response.json({ error: "not found" }, { status: 404 });
  return callback(env, request);
}
