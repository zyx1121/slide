import { notFound } from "next/navigation";

import { AccountActions } from "@/components/account-actions";
import { Editor } from "@/components/editor/editor";
import { TaskShell } from "@/components/task-shell";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { getDeck } from "@/lib/deck/store";

export const dynamic = "force-dynamic";

export default async function DeckPage({ params }: PageProps<"/decks/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  // Someone else's deck is a 404, the same as a deck that does not exist.
  const deck = await getDeck(sql, user.sub, id);
  if (!deck) notFound();

  return (
    <TaskShell
      title={deck.title}
      lang="zh-TW"
      actions={<AccountActions user={user} />}
      wide
    >
      <Editor
        deckId={deck.id}
        initialDocument={deck.document}
        initialVersion={deck.version}
      />
    </TaskShell>
  );
}
