import Link from "next/link";

import { TaskShell } from "@/components/task-shell";

export default function NotFound() {
  return (
    <TaskShell title="找不到這個頁面" lang="zh-TW">
      <p className="text-muted-foreground">
        這裡沒有東西，或是它屬於別人。
        <Link href="/" className="text-foreground hover:underline">
          回到簡報列表
        </Link>
        。
      </p>
    </TaskShell>
  );
}
