import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConsentButton } from "@/components/consent-button";
import { TaskShell } from "@/components/task-shell";
import { Button } from "@/components/ui/button";
import { safeNext } from "@/lib/auth/redirect";
import { getSession } from "@/lib/auth/session";
import type { Consent } from "@/lib/mcp/flow";
import {
  authorizeQuery,
  FLOW_SECONDS,
  mcpEnv,
  readAuthorize,
  resourceUrl,
  sign,
} from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "允許存取簡報",
  robots: { index: false, follow: false },
};

/**
 * GET /oauth/authorize: an MCP client asks to act for the member. A member
 * who is not signed in signs in first and comes back here. The member
 * decides on every connection; nothing is remembered.
 */
export default async function Authorize({
  searchParams,
}: PageProps<"/oauth/authorize">) {
  const env = mcpEnv();
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
  }
  const checked = env ? readAuthorize(env, params) : null;
  if (!env || !checked || !checked.ok) {
    if (checked && !checked.ok && checked.redirect) redirect(checked.redirect);
    return (
      <TaskShell title="無法授權" lang="zh-TW">
        <p className="text-sm text-muted-foreground">
          {env
            ? `這個應用程式的授權要求有問題：${checked && !checked.ok ? checked.error : ""}。`
            : "這個網站還沒有設定登入，無法連線。"}
        </p>
      </TaskShell>
    );
  }
  const { request } = checked;
  const member = await getSession();
  if (!member) {
    const here = `/oauth/authorize?${authorizeQuery(request, resourceUrl(env))}`;
    if (safeNext(here) !== here) {
      return (
        <TaskShell title="無法授權" lang="zh-TW">
          <p className="text-sm text-muted-foreground">
            這個授權要求太長，登入後無法回到這裡。請回到應用程式重新連線。
          </p>
        </TaskShell>
      );
    }
    redirect(`/auth/login?next=${encodeURIComponent(here)}`);
  }
  const tx = sign(
    env,
    "consent",
    { r: request, m: member.sub } satisfies Consent,
    FLOW_SECONDS
  );
  const host = new URL(request.redirectUri).host;
  const who = request.verified ? request.name : "未驗證的應用程式";

  return (
    <TaskShell title="允許存取簡報" lang="zh-TW">
      <div className="flex flex-col gap-6 text-sm">
        <p>
          <strong className="font-medium">{who}</strong>
          想要以你的身分讀取和修改你的簡報（所有簡報、內容、投影片圖片、你在編輯器的選取與評論）。它可以修改、公開與刪除簡報，每個動作都記在紀錄裡，可以在編輯器單獨還原；刪除的簡報可以從首頁的「最近刪除」救回。
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <dt>應用程式</dt>
          <dd className="break-all">{request.clientId}</dd>
          <dt>授權後回到</dt>
          <dd className="break-all">{host}</dd>
        </dl>
        {!request.verified && (
          <p className="text-xs text-muted-foreground">
            這個應用程式在你自己的電腦上執行，無法確認它是誰。只有在你剛剛自己從
            Claude Code 或其他程式連線時才允許。
          </p>
        )}
        <form method="post" action="/oauth/approve" className="flex gap-2">
          <input type="hidden" name="tx" value={tx} />
          <ConsentButton />
          <Button type="submit" name="decision" value="deny" variant="ghost">
            拒絕
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          你目前以 {member.email} 登入。隨時可以在應用程式那邊中斷連線。
        </p>
      </div>
    </TaskShell>
  );
}
