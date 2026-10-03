"use server";

// Deck actions for the home page. A server action is a public POST endpoint
// whatever page shows its button, so each one checks the session itself and
// passes the member's sub to the store, which scopes every query by owner.
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { DECK_TITLE_MAX } from "@/lib/deck/limits";
import { createDeck, deleteDeck, renameDeck } from "@/lib/deck/store";

export type ActionResult = { ok: true } | { ok: false; error: string };

const MALFORMED: ActionResult = { ok: false, error: "請求格式不正確。" };

/** Creates a deck on the WinLab template and opens it. */
export async function createDeckAction(): Promise<void> {
  const user = await requireUser();
  const deck = await createDeck(sql, user.sub);
  redirect(`/decks/${deck.id}`);
}

export async function renameDeckAction(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = form.get("id");
  const title = form.get("title");
  if (typeof id !== "string" || typeof title !== "string") return MALFORMED;
  const value = title.trim();
  if (!value) return { ok: false, error: "請輸入名稱。" };
  if (value.length > DECK_TITLE_MAX) {
    return { ok: false, error: `名稱最多 ${DECK_TITLE_MAX} 個字。` };
  }
  if (!(await renameDeck(sql, user.sub, id, value))) {
    return { ok: false, error: "找不到這份簡報，可能已經刪除。" };
  }
  refresh();
  return { ok: true };
}

export async function deleteDeckAction(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = form.get("id");
  if (typeof id !== "string") return MALFORMED;
  // A deck that is already gone needs nothing more; the list refreshes anyway.
  await deleteDeck(sql, user.sub, id);
  refresh();
  return { ok: true };
}
