import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConsentButton } from "@/components/consent-button";
import { TaskShell } from "@/components/task-shell";
import { Button } from "@/components/ui/button";
import { FLOW_SECONDS, mcpEnv, readAuthorize, sign } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "允許存取簡報",
  robots: { index: false, follow: false },
};

/**
 * GET /oauth/authorize: an MCP client asks to act for the member. The
 * member decides here, on every sign-in; nothing is remembered. Approving
 * goes on to Keycloak, where the member signs in.
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
            : "這個網站還沒有開放 MCP。"}
        </p>
      </TaskShell>
    );
  }
  const { request } = checked;
  const tx = sign(env, "consent", { r: request }, FLOW_SECONDS);
  const host = new URL(request.redirectUri).host;
  const who = request.verified ? request.name : "未驗證的應用程式";

  return (
    <TaskShell title="允許存取簡報" lang="zh-TW">
      <div className="flex flex-col gap-6 text-sm">
        <p>
          <strong className="font-medium">{who}</strong>
          想要以你的身分讀取你的簡報（所有簡報、內容與投影片圖片）。
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
          允許後會轉到 WinLab 登入。隨時可以在應用程式那邊中斷連線。
        </p>
      </div>
    </TaskShell>
  );
}
