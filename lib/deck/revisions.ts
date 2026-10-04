// The deck's history (PLAN.md, Rule 2). Every change to a deck is an entry:
// a document edit (a patch with its inverse), or a deck action (publish,
// unpublish, delete, restore). The member's and their agent's apply at once
// alike; any applied edit can be reverted on its own while nothing later
// touched what it changed. A deck action is undone by its opposite action,
// not by a revert. Every query is scoped to the deck's owner; `by`
// names who acts for them.
import type postgres from "postgres";

import { newId } from "../ids";
import { DeckError } from "./errors";
import { applyOperations, type Operation } from "./patch";
import type { DeckDocument } from "./schema";

type Db = postgres.Sql;
type Tx = postgres.TransactionSql;

export type Who = "member" | "agent";

/** What an entry does: a document edit, or an action on the deck itself. */
export type EntryKind = "edit" | DeckAction;
export type DeckAction = "publish" | "unpublish" | "delete" | "restore";

export type Revision = {
  id: string;
  kind: EntryKind;
  /** Rejected: a suggestion from before edits applied at once, never taken. */
  status: "applied" | "rejected";
  author: Who;
  /** The deck version the entry was written against, and the one it made. */
  baseVersion: number;
  version: number | null;
  createdAt: Date;
  /** How many operations change something (id tests not counted). */
  changes: number;
};

type Row = {
  id: string;
  kind: EntryKind;
  status: Revision["status"];
  author_kind: Who;
  base_version: number;
  version: number | null;
  created_at: Date;
  patch: Operation[];
};

const asJson = (value: unknown) => value as postgres.JSONValue;

function toRevision(row: Row): Revision {
  return {
    id: String(row.id),
    kind: row.kind,
    status: row.status,
    author: row.author_kind,
    baseVersion: row.base_version,
    version: row.version,
    createdAt: row.created_at,
    changes: row.patch.filter((op) => op.op !== "test").length,
  };
}

/** The deck's history, newest first; empty when the deck is not the owner's. */
export async function listRevisions(
  db: Db,
  owner: string,
  deckId: string,
  limit = 100
): Promise<Revision[]> {
  const rows = await db<Row[]>`
    select r.id, r.kind, r.status, r.author_kind, r.base_version, r.version,
      r.created_at, r.patch
    from revisions r
    join decks d on d.id = r.deck_id
    where r.deck_id = ${deckId} and d.owner_sub = ${owner}
      and d.deleted_at is null
    order by r.id desc
    limit ${limit}`;
  return rows.map(toRevision);
}

export type Outcome =
  | { outcome: "applied"; version: number; kind: EntryKind }
  | { outcome: "already" }
  | { outcome: "conflict"; message: string }
  | { outcome: "gone" };

/** Applies a patch to the locked deck; the deck's new version. */
async function applyToDeck(
  tx: Tx,
  deckId: string,
  document: DeckDocument,
  version: number,
  ops: Operation[]
) {
  const result = applyOperations(document, ops);
  const next = version + 1;
  await tx`
    update decks
    set document = ${tx.json(asJson(result.document))},
        title = ${result.document.title},
        version = ${next},
        updated_at = now()
    where id = ${deckId}`;
  return { next, result };
}

const conflictOf = (error: unknown): Outcome => {
  if (error instanceof DeckError) {
    if (error.message === "the patch changes nothing")
      return { outcome: "already" };
    return {
      outcome: "conflict",
      message: error.details.issues?.[0] ?? error.message,
    };
  }
  throw error;
};

type LockedDeck = {
  document: DeckDocument;
  version: number;
  published: boolean;
  deleted: boolean;
};

/** The owner's deck, locked for the transaction, deleted or not. */
async function lockDeck(
  tx: Tx,
  owner: string,
  deckId: string
): Promise<LockedDeck | null> {
  const [deck] = await tx<LockedDeck[]>`
    select document, version, published, deleted_at is not null as deleted
    from decks
    where id = ${deckId} and owner_sub = ${owner}
    for update`;
  return deck ?? null;
}

/** Whether a deck action would change anything on the deck as it is. */
function changes(deck: LockedDeck, action: DeckAction): boolean {
  switch (action) {
    case "publish":
      return !deck.deleted && !deck.published;
    case "unpublish":
      return !deck.deleted && deck.published;
    case "delete":
      return !deck.deleted;
    case "restore":
      return deck.deleted;
  }
}

/** Carries out a deck action on the locked deck. */
async function applyAction(tx: Tx, deckId: string, action: DeckAction) {
  switch (action) {
    case "publish":
      // The public id is made on the first publish and kept, so publishing
      // again brings the same link back.
      await tx`
        update decks
        set published = true, public_id = coalesce(public_id, ${newPublicId()})
        where id = ${deckId}`;
      return;
    case "unpublish":
      await tx`update decks set published = false where id = ${deckId}`;
      return;
    case "delete":
      await tx`update decks set deleted_at = now() where id = ${deckId}`;
      return;
    case "restore":
      await tx`update decks set deleted_at = null where id = ${deckId}`;
      return;
  }
}

/** A public id: 16 characters, about 79 bits, so links cannot be guessed. */
function newPublicId(): string {
  return newId("p", 16).slice(2);
}

export type DeckActionResult =
  | { outcome: "applied"; revisionId: string }
  | { outcome: "already" }
  | { outcome: "gone" };

/** A deck action by the member or their agent, applied and recorded. */
export async function actOnDeck(
  db: Db,
  owner: string,
  deckId: string,
  action: DeckAction,
  by: Who = "member"
): Promise<DeckActionResult> {
  return db.begin((tx) => act(tx, owner, deckId, action, by));
}

async function act(
  tx: Tx,
  owner: string,
  deckId: string,
  action: DeckAction,
  by: Who
): Promise<DeckActionResult> {
  const deck = await lockDeck(tx, owner, deckId);
  if (!deck) return { outcome: "gone" };
  if (!changes(deck, action)) return { outcome: "already" };
  await applyAction(tx, deckId, action);
  const [entry] = await tx<{ id: string }[]>`
    insert into revisions
      (deck_id, kind, base_version, version, author_kind, author_sub, status,
       decided_kind, decided_at)
    values (${deckId}, ${action}, ${deck.version}, ${deck.version}, ${by},
      ${owner}, 'applied', ${by}, now())
    returning id`;
  return { outcome: "applied", revisionId: String(entry.id) };
}

/**
 * Tests that what a patch set is still there: for every member it added or
 * replaced, a test of its value. A revert is refused when a later edit
 * changed the same place, rather than silently undoing that edit too.
 */
function stillThere(patch: Operation[]): Operation[] {
  return patch.flatMap((op): Operation[] =>
    (op.op === "add" || op.op === "replace") && !op.path.endsWith("/-")
      ? [{ op: "test", path: op.path, value: op.value }]
      : []
  );
}

/**
 * Reverts one applied edit, as a new entry: its inverse, after checking that
 * what the edit set is still there. A deck action is refused: its opposite
 * action undoes it (restore for delete, unpublish for publish).
 */
export async function revertRevision(
  db: Db,
  owner: string,
  deckId: string,
  revisionId: string,
  by: Who = "member"
): Promise<Outcome> {
  return db.begin(async (tx) => {
    const deck = await lockDeck(tx, owner, deckId);
    if (!deck) return { outcome: "gone" };
    const [row] = await tx<
      { kind: EntryKind; patch: Operation[]; inverse: Operation[] | null }[]
    >`
      select kind, patch, inverse from revisions
      where id = ${revisionId} and deck_id = ${deckId} and status = 'applied'`;
    if (!row) return { outcome: "gone" };

    if (row.kind !== "edit") {
      return {
        outcome: "conflict",
        message:
          "公開、取消公開、刪除和還原簡報不從紀錄還原，請用相反的動作（發布按鈕或最近刪除）。",
      };
    }

    if (deck.deleted || !row.inverse?.length) return { outcome: "gone" };
    const ops = [...stillThere(row.patch), ...row.inverse];
    let applied;
    try {
      applied = await applyToDeck(tx, deckId, deck.document, deck.version, ops);
    } catch (error) {
      const outcome = conflictOf(error);
      return outcome.outcome === "conflict"
        ? {
            outcome: "conflict",
            message: "後來的修改動過同一個地方，無法單獨還原。",
          }
        : outcome;
    }
    await tx`
      insert into revisions
        (deck_id, base_version, version, author_kind, author_sub, status,
         patch, inverse, decided_kind, decided_at)
      values
        (${deckId}, ${deck.version}, ${applied.next}, ${by}, ${owner}, 'applied',
         ${tx.json(asJson(applied.result.operations))},
         ${tx.json(asJson(applied.result.inverse))}, ${by}, now())`;
    return { outcome: "applied", version: applied.next, kind: "edit" };
  });
}
