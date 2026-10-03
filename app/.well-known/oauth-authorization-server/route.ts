import { authorizationServer, documentResponse } from "@/lib/mcp/metadata";
import { mcpEnv } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

/** The authorization server metadata (RFC 8414) of the MCP OAuth front. */
export function GET() {
  const env = mcpEnv();
  return documentResponse(env && authorizationServer(env));
}
