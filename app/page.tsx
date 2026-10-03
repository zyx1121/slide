import { AccountActions } from "@/components/account-actions";
import { DeckCard } from "@/components/deck-card";
import { NewDeckButton } from "@/components/new-deck-button";
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
      actions={
        <>
          <NewDeckButton />
          <AccountActions user={user} current="decks" />
        </>
      }
    >
      {decks.length === 0 ? (
        <p className="text-muted-foreground">
          還沒有簡報。按右上角的「新增」，從 WinLab 範本開始。
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-5 gap-y-10 sm:grid-cols-2 2xl:grid-cols-3">
          {decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} />
          ))}
        </ul>
      )}
    </TaskShell>
  );
}
