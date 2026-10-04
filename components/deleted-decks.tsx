"use client";

import { useActionState } from "react";

import { type ActionResult, restoreDeckAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** One deleted deck, with the button that brings it back. */
function DeletedDeck({
  id,
  title,
  when,
}: {
  id: string;
  title: string;
  when: string;
}) {
  const [state, action, pending] = useActionState(
    (_: ActionResult | null, form: FormData) => restoreDeckAction(form),
    null
  );
  return (
    <li className="flex items-center justify-between gap-4">
      <span className="min-w-0 truncate text-sm">
        {title}
        <span className="ml-2 text-xs text-muted-foreground">{when}</span>
      </span>
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        {state && !state.ok && (
          <span role="status" className="text-xs text-destructive">
            {state.error}
          </span>
        )}
        <Button
          type="submit"
          variant="ghost"
          disabled={pending}
          aria-label={`還原「${title}」`}
        >
          還原
        </Button>
      </form>
    </li>
  );
}

/** The home page's list of deleted decks; nothing while there is none. */
export function DeletedDecks({
  decks,
}: {
  decks: { id: string; title: string; when: string }[];
}) {
  if (decks.length === 0) return null;
  return (
    <section
      aria-labelledby="deleted-decks"
      className="mt-16 flex flex-col gap-3"
    >
      <h2 id="deleted-decks" className="text-xs text-muted-foreground">
        最近刪除
      </h2>
      <ul className="flex flex-col gap-1">
        {decks.map((deck) => (
          <DeletedDeck key={deck.id} {...deck} />
        ))}
      </ul>
    </section>
  );
}
