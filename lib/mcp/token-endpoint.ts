// POST /oauth/token: a code (with its PKCE verifier) or a refresh token,
// traded for tokens Slide issues itself (grants.ts). Clients are public:
// they prove nothing but holding the code or the refresh token.
import type postgres from "postgres";

import { redeemCode, refresh } from "./grants";
import { type McpEnv, readForm } from "./oauth";

const answer = (body: object, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", pragma: "no-cache" },
  });

export async function token(
  env: McpEnv,
  request: Request,
  db: postgres.Sql
): Promise<Response> {
  const read = await readForm(request);
  if (!read.ok) return answer({ error: "invalid_request" }, read.status);
  const field = (name: string) => read.form.get(name)?.toString() ?? "";
  const grant = field("grant_type");
  const clientId = field("client_id");
  if (!clientId || clientId.length > 512) {
    return answer({ error: "invalid_request" });
  }

  let result;
  if (grant === "authorization_code") {
    const verifier = field("code_verifier");
    const code = field("code");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !code) {
      return answer({ error: "invalid_request" });
    }
    result = await redeemCode(db, env, {
      code,
      clientId,
      redirectUri: field("redirect_uri"),
      verifier,
    });
  } else if (grant === "refresh_token") {
    const presented = field("refresh_token");
    if (!presented) return answer({ error: "invalid_request" });
    result = await refresh(db, env, { token: presented, clientId });
  } else {
    return answer({ error: "unsupported_grant_type" });
  }
  return "error" in result ? answer(result, 400) : answer(result);
}
