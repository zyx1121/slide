import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Presenter } from "@/components/present/presenter";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { getDeck } from "@/lib/deck/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "簡報者模式" };

/**
 * The presenter view of the member's deck, from slide `from` (1 first): the
 * slides and the speaker notes, driving the projection window.
 */
export default async function PresentPage({
  params,
  searchParams,
}: PageProps<"/decks/[id]/present">) {
  const { id } = await params;
  const { from, blocked } = await searchParams;
  const user = await requireUser();
  const deck = await getDeck(sql, user.sub, id);
  if (!deck) notFound();
  const last = deck.document.slides.length - 1;
  const start = Math.min(Math.max(Number(from) - 1 || 0, 0), last);

  return (
    <Presenter
      deckId={deck.id}
      title={deck.title}
      initialDocument={deck.document}
      initialVersion={deck.version}
      start={start}
      screenBlocked={blocked === "1"}
    />
  );
}
