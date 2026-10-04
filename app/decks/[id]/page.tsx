import { notFound } from "next/navigation";

import { Editor } from "@/components/editor/editor";
import { StageShell } from "@/components/stage-shell";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { storedDocumentProblem } from "@/lib/deck/schema";
import { getDeck } from "@/lib/deck/store";
import { describeSkipped } from "@/lib/pptx/report";

export const dynamic = "force-dynamic";

export default async function DeckPage({
  params,
  searchParams,
}: PageProps<"/decks/[id]">) {
  const { id } = await params;
  // Right after an import: what the .pptx had that the deck does not.
  const { imported, slide } = await searchParams;
  let notice: string | null = null;
  if (typeof imported === "string") {
    try {
      notice = describeSkipped(JSON.parse(imported)) ?? "匯入完成。";
    } catch {
      notice = null;
    }
  }
  const user = await requireUser();
  // Someone else's deck is a 404, the same as a deck that does not exist.
  const deck = await getDeck(sql, user.sub, id);
  if (!deck) notFound();
  // Back from presenting: the slide it ended on, 1 first.
  const initialSlide = Math.min(
    Math.max(Number(slide) - 1 || 0, 0),
    deck.document.slides.length - 1
  );

  return (
    <StageShell title={deck.title}>
      <Editor
        deckId={deck.id}
        initialDocument={deck.document}
        initialVersion={deck.version}
        initialPublished={deck.published}
        initialPublicId={deck.publicId}
        invalid={storedDocumentProblem(deck.document)}
        notice={notice}
        initialSlide={initialSlide}
      />
    </StageShell>
  );
}
