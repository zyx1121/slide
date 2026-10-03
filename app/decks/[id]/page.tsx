import Link from "next/link";
import { notFound } from "next/navigation";

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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-8">
      <Link href="/" className="text-muted-foreground hover:underline">
        所有簡報
      </Link>
      <h1 className="text-2xl font-semibold">{deck.title}</h1>
      <p className="text-muted-foreground">
        {deck.document.slides.length} 頁 · 版本 {deck.version}
      </p>
    </main>
  );
}
