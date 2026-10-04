"use client";

import { useFormStatus } from "react-dom";

import { createDeckAction } from "@/app/actions";
import { CornerTip, cornerLink } from "@/components/corners";

function Submit() {
  // Held while the deck is created, so a double click makes one deck.
  const { pending } = useFormStatus();
  return (
    <CornerTip tip="建立空白簡報">
      <button type="submit" disabled={pending} className={cornerLink}>
        新增
      </button>
    </CornerTip>
  );
}

/** The home page's top-right action: a new deck, opened right away. */
export function NewDeckButton() {
  return (
    <form action={createDeckAction} className="flex">
      <Submit />
    </form>
  );
}
