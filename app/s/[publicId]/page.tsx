import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SlideView } from "@/components/slide-view";
import { TaskShell } from "@/components/task-shell";
import { cornerLink } from "@/components/corners";
import { documentAssets } from "@/lib/assets/drawn";
import { ownedAssets } from "@/lib/assets/store";
import { sql } from "@/lib/db";
import { getPublishedDeck } from "@/lib/deck/store";
import { layoutOf } from "@/lib/master/layout";

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
  // Only pictures the owner uploaded are served; others show a placeholder,
  // without their id in the page.
  const owned = await ownedAssets(
    sql,
    deck.ownerSub,
    documentAssets(deck.document)
  );
  const assetHref = (sha256: string) =>
    owned.has(sha256) ? `/s/${publicId}/assets/${sha256}` : null;

  return (
    <TaskShell
      home="https://www.zyx.tw"
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
            <SlideView
              slide={slide}
              number={i + 1}
              layout={layoutOf(deck.document, slide)}
              assetHref={assetHref}
            />
          </li>
        ))}
      </ol>
    </TaskShell>
  );
}
