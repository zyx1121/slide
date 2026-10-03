import { mcpEnv } from "@/lib/mcp/oauth";
import { token } from "@/lib/mcp/token-endpoint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /oauth/token: codes and refresh tokens, relayed to Keycloak. */
export async function POST(request: Request) {
  const env = mcpEnv();
  if (!env) return Response.json({ error: "not found" }, { status: 404 });
  return token(env, request);
}
