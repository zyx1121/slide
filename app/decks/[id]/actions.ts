"use server";

// The editor's actions. A server action is a public POST endpoint, so each
// one checks the session itself and takes nothing on trust: the editor's
// patches go through mutateDeck as the member, with the same validation,
// version check and revision history as every other write.
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { DeckError, type DeckErrorCode } from "@/lib/deck/errors";
import type { DeckDocument } from "@/lib/deck/schema";
import { getDeck, mutateDeck, setPublished } from "@/lib/deck/store";

export type EditResult =
  | { ok: true; version: number }
  | { ok: false; code: DeckErrorCode | "malformed"; currentVersion?: number };

/** Applies one patch from the editor, written against `baseVersion`. */
export async function editDeckAction(
  deckId: unknown,
  baseVersion: unknown,
  ops: unknown
): Promise<EditResult> {
  const user = await requireUser();
  if (typeof deckId !== "string" || !Number.isSafeInteger(baseVersion)) {
    return { ok: false, code: "malformed" };
  }
  try {
    const result = await mutateDeck(sql, {
      deckId,
      actor: { kind: "member", sub: user.sub },
      baseVersion: baseVersion as number,
      ops,
    });
    return { ok: true, version: result.version };
  } catch (error) {
    if (!(error instanceof DeckError)) throw error;
    return {
      ok: false,
      code: error.code,
      currentVersion: error.details.currentVersion,
    };
  }
}

/** The member's deck as it is now, for the editor to start over from. */
export async function loadDeckAction(
  deckId: unknown
): Promise<{ document: DeckDocument; version: number } | null> {
  const user = await requireUser();
  if (typeof deckId !== "string") return null;
  const deck = await getDeck(sql, user.sub, deckId);
  return deck && { document: deck.document, version: deck.version };
}

/**
 * Publishes or unpublishes the member's deck: a published deck is readable
 * by anyone with its link at /s/<public id>.
 */
export async function publishDeckAction(
  deckId: unknown,
  published: unknown
): Promise<{ published: boolean; publicId: string | null } | null> {
  const user = await requireUser();
  if (typeof deckId !== "string" || typeof published !== "boolean") {
    return null;
  }
  return setPublished(sql, user.sub, deckId, published);
}
