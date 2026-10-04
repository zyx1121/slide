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
  actOnDeck,
  listRevisions,
  type Outcome,
  revertRevision,
  type Revision,
} from "@/lib/deck/revisions";
import {
  addComment,
  addToThread,
  Body,
  type CommentResult,
  CommentInput,
  listThreads,
  type Thread,
} from "@/lib/deck/comments";
import { saveSelection, SelectionInput } from "@/lib/deck/selection";
import { deckVersion, getDeck, mutateDeck } from "@/lib/deck/store";

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

/**
 * The deck's recent history and its version now, so the editor can tell
 * when someone else, such as the member's agent, changed it.
 */
export async function historyAction(
  deckId: unknown
): Promise<{ revisions: Revision[]; version: number } | null> {
  const user = await requireUser();
  if (typeof deckId !== "string") return null;
  const [revisions, deck] = await Promise.all([
    listRevisions(sql, user.sub, deckId, 30),
    getDeck(sql, user.sub, deckId),
  ]);
  return deck && { revisions, version: deck.version };
}

/** The deck's version now; null when it is not the member's. */
export async function versionAction(deckId: unknown): Promise<number | null> {
  const user = await requireUser();
  if (typeof deckId !== "string") return null;
  return (await deckVersion(sql, user.sub, deckId)) ?? null;
}

const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9]{1,18}$/.test(value);

/** Reverts one applied entry of the deck's history, as a new entry. */
export async function revertAction(
  deckId: unknown,
  revisionId: unknown
): Promise<Outcome> {
  const user = await requireUser();
  if (typeof deckId !== "string" || !isId(revisionId))
    return { outcome: "gone" };
  return revertRevision(sql, user.sub, deckId, revisionId);
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

/** The deck's comment threads, oldest first. */
export async function commentsAction(deckId: unknown): Promise<Thread[]> {
  const user = await requireUser();
  if (typeof deckId !== "string") return [];
  return listThreads(sql, user.sub, deckId);
}

/** Starts a comment thread on what the member selected. */
export async function commentAction(
  deckId: unknown,
  input: unknown
): Promise<CommentResult> {
  const user = await requireUser();
  const parsed = CommentInput.safeParse(input);
  if (typeof deckId !== "string" || !parsed.success) {
    return { outcome: "invalid", message: "malformed" };
  }
  return addComment(sql, user.sub, deckId, parsed.data);
}

/** Replies to, resolves or reopens a thread. */
export async function threadAction(
  deckId: unknown,
  threadId: unknown,
  kind: unknown,
  body?: unknown
): Promise<CommentResult> {
  const user = await requireUser();
  if (
    typeof deckId !== "string" ||
    !isId(threadId) ||
    (kind !== "reply" && kind !== "resolve" && kind !== "reopen") ||
    (body !== undefined && typeof body !== "string")
  ) {
    return { outcome: "invalid", message: "malformed" };
  }
  if (typeof body === "string" && !Body.safeParse(body).success) {
    return { outcome: "invalid", message: "malformed" };
  }
  return addToThread(sql, user.sub, deckId, threadId, {
    kind,
    body: typeof body === "string" ? body : undefined,
  });
}
