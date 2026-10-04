"use server";

// The editor's actions. A server action is a public POST endpoint, so each
// one checks the session itself and takes nothing on trust: the editor's
// patches go through mutateDeck as the member, with the same validation,
// version check and revision history as every other write.
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { DeckError, type DeckErrorCode } from "@/lib/deck/errors";
import type { DeckDocument } from "@/lib/deck/schema";
import {
  acceptSuggestion,
  actOnDeck,
  listRevisions,
  listSuggestions,
  type Outcome,
  rejectSuggestion,
  revertRevision,
  type Revision,
  type Suggestion,
} from "@/lib/deck/revisions";
import { saveSelection, SelectionInput } from "@/lib/deck/selection";
import { getDeck, mutateDeck } from "@/lib/deck/store";

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
 * by anyone with its link at /s/<public id>. Either is an entry in the
 * deck's history.
 */
export async function publishDeckAction(
  deckId: unknown,
  published: unknown
): Promise<{ published: boolean; publicId: string | null } | null> {
  const user = await requireUser();
  if (typeof deckId !== "string" || typeof published !== "boolean") {
    return null;
  }
  const result = await actOnDeck(
    sql,
    user.sub,
    deckId,
    published ? "publish" : "unpublish"
  );
  if (result.outcome === "gone") return null;
  const deck = await getDeck(sql, user.sub, deckId);
  return deck && { published: deck.published, publicId: deck.publicId };
}

/** The deck's pending suggestions and its recent history. */
export async function reviewAction(
  deckId: unknown
): Promise<{ suggestions: Suggestion[]; revisions: Revision[] } | null> {
  const user = await requireUser();
  if (typeof deckId !== "string") return null;
  const [suggestions, revisions] = await Promise.all([
    listSuggestions(sql, user.sub, deckId),
    listRevisions(sql, user.sub, deckId, 30),
  ]);
  return { suggestions, revisions };
}

const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9]{1,18}$/.test(value);

/** Accepts or rejects a suggestion, or reverts an applied revision. */
export async function reviseAction(
  deckId: unknown,
  revisionId: unknown,
  action: unknown
): Promise<Outcome | { outcome: "rejected" }> {
  const user = await requireUser();
  if (typeof deckId !== "string" || !isId(revisionId))
    return { outcome: "gone" };
  if (action === "accept") {
    return acceptSuggestion(sql, user.sub, deckId, revisionId);
  }
  if (action === "reject") {
    return (await rejectSuggestion(sql, user.sub, deckId, revisionId))
      ? { outcome: "rejected" }
      : { outcome: "gone" };
  }
  if (action === "revert") {
    return revertRevision(sql, user.sub, deckId, revisionId);
  }
  return { outcome: "gone" };
}

/** Stores what the member selected, for their agent (get_selection). */
export async function selectAction(
  deckId: unknown,
  input: unknown
): Promise<boolean> {
  const user = await requireUser();
  const parsed = SelectionInput.safeParse(input);
  if (typeof deckId !== "string" || !parsed.success) return false;
  return saveSelection(sql, user.sub, deckId, parsed.data);
}
