import { notFound } from "next/navigation";

import { AccountActions } from "@/components/account-actions";
import { SlideView } from "@/components/slide-view";
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
      description={`${deck.document.slides.length} 頁，版本 ${deck.version}`}
      lang="zh-TW"
      actions={<AccountActions user={user} />}
      wide
    >
      <ol className="flex flex-col gap-10">
        {deck.document.slides.map((slide, index) => (
          <li key={slide.id} className="flex flex-col gap-3">
            <SlideView slide={slide} number={index + 1} />
            <span className="text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
          </li>
        ))}
      </ol>
    </TaskShell>
  );
}
