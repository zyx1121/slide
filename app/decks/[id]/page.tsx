import { notFound } from "next/navigation";

import { Editor } from "@/components/editor/editor";
import { StageShell } from "@/components/stage-shell";
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
    <StageShell title={deck.title}>
      <Editor
        deckId={deck.id}
        initialDocument={deck.document}
        initialVersion={deck.version}
      />
    </StageShell>
  );
}
