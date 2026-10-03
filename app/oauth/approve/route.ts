import { approve } from "@/lib/mcp/flow";
import { mcpEnv } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

/** POST /oauth/approve: the member's answer on the consent page. */
export async function POST(request: Request) {
  const env = mcpEnv();
  if (!env) return Response.json({ error: "not found" }, { status: 404 });
  return approve(env, request);
}
