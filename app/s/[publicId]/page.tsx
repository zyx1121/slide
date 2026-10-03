import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SlideView } from "@/components/slide-view";
import { TaskShell } from "@/components/task-shell";
import { cornerLink } from "@/components/corners";
import { sql } from "@/lib/db";
import { getPublishedDeck } from "@/lib/deck/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/s/[publicId]">): Promise<Metadata> {
  const { publicId } = await params;
  const deck = await getPublishedDeck(sql, publicId);
  return {
    title: deck?.title ?? "找不到簡報",
    // A published deck is shared by its link, not listed by search engines.
    robots: { index: false, follow: false },
  };
}

/** A published deck, read only, for anyone with the link. */
export default async function PublicDeck({
  params,
}: PageProps<"/s/[publicId]">) {
  const { publicId } = await params;
  const deck = await getPublishedDeck(sql, publicId);
  if (!deck) notFound();
  const assetHref = (sha256: string) => `/s/${publicId}/assets/${sha256}`;

  return (
    <TaskShell
      title={deck.title}
      lang="zh-TW"
      wide
      actions={
        <a href={`/s/${publicId}/export`} download className={cornerLink}>
          下載 PowerPoint
        </a>
      }
    >
      <ol className="flex flex-col gap-6">
        {deck.document.slides.map((slide, i) => (
          <li key={slide.id}>
            <SlideView slide={slide} number={i + 1} assetHref={assetHref} />
          </li>
        ))}
      </ol>
    </TaskShell>
  );
}
