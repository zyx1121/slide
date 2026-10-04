"use server";

// Deck actions for the home page. A server action is a public POST endpoint
// whatever page shows its button, so each one checks the session itself and
// passes the member's sub to the store, which scopes every query by owner.
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { DeckError } from "@/lib/deck/errors";
import { DECK_TITLE_MAX } from "@/lib/deck/limits";
import {
  createDeck,
  deleteDeck,
  renameDeck,
  restoreDeck,
} from "@/lib/deck/store";

export type ActionResult = { ok: true } | { ok: false; error: string };

const MALFORMED: ActionResult = { ok: false, error: "請求格式不正確。" };

/** Creates a deck on the plain template and opens it. */
export async function createDeckAction(): Promise<void> {
  const user = await requireUser();
  const deck = await createDeck(sql, user.sub);
  // The browser's back button would otherwise show the list without it.
  revalidatePath("/");
  redirect(`/decks/${deck.id}`);
}

/** What a member reads when the store refuses a write. */
function refused(error: unknown): ActionResult {
  if (!(error instanceof DeckError)) throw error;
  switch (error.code) {
    case "conflict":
      return { ok: false, error: "簡報剛好在別處更新，請再試一次。" };
    case "invalid_document":
      return { ok: false, error: "名稱含有無法儲存的字元。" };
    default:
      return { ok: false, error: "沒有存到，請再試一次。" };
  }
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
  try {
    if (!(await renameDeck(sql, user.sub, id, value))) {
      return { ok: false, error: "找不到這份簡報，可能已經刪除。" };
    }
  } catch (error) {
    return refused(error);
  }
  refresh();
  return { ok: true };
}

/** Brings back a deck the member deleted, from the home page's list. */
export async function restoreDeckAction(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = form.get("id");
  if (typeof id !== "string") return MALFORMED;
  await restoreDeck(sql, user.sub, id);
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
