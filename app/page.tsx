import { AccountActions } from "@/components/account-actions";
import { DeckCard } from "@/components/deck-card";
import { DeletedDecks } from "@/components/deleted-decks";
import { ImportDeckButton } from "@/components/import-deck-button";
import { NewDeckButton } from "@/components/new-deck-button";
import { TaskShell } from "@/components/task-shell";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { listDecks, listDeletedDecks } from "@/lib/deck/store";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const [decks, deleted] = await Promise.all([
    listDecks(sql, user.sub),
    listDeletedDecks(sql, user.sub),
  ]);

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
          還沒有簡報。按右上角的「新增」選母片開始，或按「匯入」從 PowerPoint
          檔開始。
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-5 gap-y-10 sm:grid-cols-2 2xl:grid-cols-3">
          {decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} />
          ))}
        </ul>
      )}
      <DeletedDecks
        decks={deleted.map((deck) => ({
          id: deck.id,
          title: deck.title,
          when: formatDateTime(deck.deletedAt),
        }))}
      />
    </TaskShell>
  );
}
