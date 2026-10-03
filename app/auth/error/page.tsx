import { TaskShell } from "@/components/task-shell";

export const dynamic = "force-dynamic";

const REASONS = {
  expired: {
    title: "登入逾時",
    body: "這次登入已經過期，或瀏覽器擋掉了 cookie。",
  },
  failed: { title: "登入失敗", body: "登入沒有完成，請再試一次。" },
  unavailable: {
    title: "暫時無法登入",
    body: "登入服務沒有回應，請稍後再試。",
  },
} as const;

export default async function SignInError({
  searchParams,
}: PageProps<"/auth/error">) {
  const { reason } = await searchParams;
  const { title, body } =
    REASONS[
      (typeof reason === "string" && reason in REASONS
        ? reason
        : "failed") as keyof typeof REASONS
    ];
  return (
    <TaskShell title={title} lang="zh-TW">
      <p className="text-muted-foreground">
        {body}
        <a href="/auth/login" className="text-foreground hover:underline">
          重新登入
        </a>
        。
      </p>
    </TaskShell>
  );
}
