import { DeckRow } from "@/components/deck-row";
import { SlideView } from "@/components/slide-view";
import type { DeckSummary } from "@/lib/deck/store";
import { formatDateTime } from "@/lib/format";

/**
 * One deck on the home page: its first slide, drawn on the server, above the
 * title, size, last edit and actions.
 */
export function DeckCard({ deck }: { deck: DeckSummary }) {
  return (
    <li className="relative flex flex-col gap-3">
      <SlideView slide={deck.firstSlide} number={1} decorative />
      <DeckRow
        id={deck.id}
        title={deck.title}
        slideCount={deck.slideCount}
        updated={{
          iso: deck.updatedAt.toISOString(),
          text: formatDateTime(deck.updatedAt),
        }}
      />
    </li>
  );
}
