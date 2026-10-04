import { AccountActions } from "@/components/account-actions";
import { DeckCard } from "@/components/deck-card";
import { ImportDeckButton } from "@/components/import-deck-button";
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
          <ImportDeckButton />
          <AccountActions user={user} current="decks" />
        </>
      }
    >
      {decks.length === 0 ? (
        <p className="text-muted-foreground">
          還沒有簡報。按右上角的「新增」，從空白簡報開始；或按「匯入」，從
          PowerPoint 檔開始。範本可以在編輯器裡切換。
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
