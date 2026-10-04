// The browser step of the MCP authorization server: the member's answer on
// the consent page. See oauth.ts for the whole flow.
import type { NextRequest } from "next/server";
import type postgres from "postgres";

import { readSession } from "../auth/session";
import { createCode } from "./grants";
import {
  type AuthorizeRequest,
  issuerUrl,
  type McpEnv,
  readForm,
  unsign,
} from "./oauth";

/** The client's redirect URI with the answer for it. */
function back(
  env: McpEnv,
  request: AuthorizeRequest,
  answer: Record<string, string>
): string {
  const url = new URL(request.redirectUri);
  for (const [name, value] of Object.entries(answer)) {
    url.searchParams.set(name, value);
  }
  if (request.state) url.searchParams.set("state", request.state);
  url.searchParams.set("iss", issuerUrl(env));
  return url.href;
}

const see = (location: string) =>
  new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
  });

const page = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });

/** What the consent page signs into its form: the request and who saw it. */
export type Consent = { r: AuthorizeRequest; m: string };

/**
 * POST /oauth/approve: the consent page's form. Only from this site's own
 * page, and only by the signed-in member the page was shown to; denying
 * sends the client an error, allowing sends it a one-time code.
 */
export async function approve(
  env: McpEnv,
  request: NextRequest,
  db: postgres.Sql
): Promise<Response> {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // A browser names where a form came from; without either header, nothing
  // says it was this site's page.
  if (
    (!origin && !site) ||
    (origin && origin !== env.appUrl.origin) ||
    (site && site !== "same-origin")
  ) {
    return page(403, "Forbidden");
  }
  const read = await readForm(request);
  if (!read.ok && read.status === 413) return page(413, "Payload Too Large");
  const form = read.ok ? read.form : null;
  const tx = unsign<Consent>(env, "consent", form?.get("tx")?.toString());
  if (!tx) return page(400, "這個授權要求已過期，請回到應用程式重新連線。");
  const member = await readSession(request, env.auth);
  if (!member || member.sub !== tx.m) {
    return page(
      403,
      "請用剛剛看到授權頁的帳號登入後，再回到應用程式重新連線。"
    );
  }
  if (form?.get("decision") !== "allow") {
    return see(back(env, tx.r, { error: "access_denied" }));
  }
  // A session whose member has no row (moved to another subject, say) gets
  // no code: the code would name nobody.
  const [known] = await db`select 1 from users where sub = ${member.sub}`;
  if (!known) {
    return page(403, "請重新登入後，再回到應用程式重新連線。");
  }
  const code = await createCode(db, {
    sub: member.sub,
    clientId: tx.r.clientId,
    redirectUri: tx.r.redirectUri,
    challenge: tx.r.codeChallenge,
    scope: tx.r.scope,
  });
  return see(back(env, tx.r, { code }));
}
