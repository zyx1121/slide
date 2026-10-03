import { documentResponse, protectedResource } from "@/lib/mcp/metadata";
import { mcpEnv } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

/** The protected resource metadata (RFC 9728) of /mcp. */
export function GET() {
  const env = mcpEnv();
  return documentResponse(env && protectedResource(env));
}
