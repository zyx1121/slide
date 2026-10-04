import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Screen } from "@/components/present/screen";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { getDeck } from "@/lib/deck/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "投影畫面" };

/** The projection window of the member's deck: only the slides, for the projector. */
export default async function ScreenPage({
  params,
}: PageProps<"/decks/[id]/present/screen">) {
  const { id } = await params;
  const user = await requireUser();
  const deck = await getDeck(sql, user.sub, id);
  if (!deck) notFound();
  return <Screen deckId={deck.id} initialDocument={deck.document} />;
}
