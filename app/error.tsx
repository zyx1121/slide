"use client";

import Link from "next/link";

import { TaskShell } from "@/components/task-shell";
import { Button, buttonVariants } from "@/components/ui/button";

/** Shown when a page or an action fails unexpectedly, instead of Next's page. */
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <TaskShell title="出了點問題" lang="zh-TW">
      <div className="flex flex-col items-start gap-5">
        <p className="text-muted-foreground">
          這個頁面或動作沒有完成。請再試一次，或回到簡報列表。
        </p>
        <div className="flex gap-2">
          <Button onClick={() => retry()}>再試一次</Button>
          <Link href="/" className={buttonVariants({ variant: "ghost" })}>
            回到簡報
          </Link>
        </div>
      </div>
    </TaskShell>
  );
}
