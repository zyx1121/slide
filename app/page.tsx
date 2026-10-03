import Link from "next/link";

import { AccountActions } from "@/components/account-actions";
import { TaskShell } from "@/components/task-shell";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { listDecks } from "@/lib/deck/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const decks = await listDecks(sql, user.sub);

  return (
    <TaskShell
      title="簡報"
      lang="zh-TW"
      actions={<AccountActions user={user} current="decks" />}
    >
      {decks.length === 0 ? (
        <p className="text-muted-foreground">還沒有簡報。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {decks.map((deck) => (
            <li
              key={deck.id}
              className="flex items-baseline justify-between gap-4"
            >
              <Link href={`/decks/${deck.id}`} className="hover:underline">
                {deck.title}
              </Link>
              <span className="text-xs text-muted-foreground tabular-nums">
                {deck.updatedAt.toLocaleDateString("zh-TW")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </TaskShell>
  );
}
