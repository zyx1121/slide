"use client";

import { useFormStatus } from "react-dom";

import { createDeckAction } from "@/app/actions";
import { SlideView } from "@/components/slide-view";
import type { Layout } from "@/lib/deck/schema";

const EMPTY = { id: "sl_preview", title: "", shapes: [] };

function Submit({ name, layout }: { name: string; layout: Layout }) {
  // Held while the deck is made, so a double click makes one deck.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full flex-col gap-3 rounded-lg text-left outline-offset-4 focus-visible:outline-2 disabled:opacity-50"
    >
      <SlideView slide={EMPTY} number={1} layout={layout} decorative />
      <span className="text-sm">{name}</span>
    </button>
  );
}

/** One master on the new-deck page: its default layout, and its name. */
export function MasterChoice({
  masterRef,
  name,
  layout,
}: {
  /** What createDeckAction takes: a built-in's id or a master file's sha256. */
  masterRef: string;
  name: string;
  layout: Layout;
}) {
  return (
    <li>
      <form action={createDeckAction}>
        <input type="hidden" name="master" value={masterRef} />
        <Submit name={name} layout={layout} />
      </form>
    </li>
  );
}
