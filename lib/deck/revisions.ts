// Suggestions and history (PLAN.md, Rule 2). Every change to a deck is an
// entry: a document edit (a patch), or a deck action (publish, unpublish,
// delete, restore). An agent's edit waits as a suggestion, and its risky
// action (publish, delete) as a request, until the member or an agent
// accepts or rejects it; every applied entry can be reverted on its own
// while nothing later touched what it changed. Every query is scoped to the
// deck's owner; `by` names who acts for them.
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

/** Deck actions an agent may only ask for: they reach the outside or remove. */
export const RISKY: ReadonlySet<DeckAction> = new Set(["publish", "delete"]);

/** The action that undoes a deck action. */
const UNDO: Record<DeckAction, DeckAction> = {
  publish: "unpublish",
  unpublish: "publish",
  delete: "restore",
  restore: "delete",
};

export type Revision = {
  id: string;
  kind: EntryKind;
  status: "applied" | "suggested" | "rejected";
  author: Who;
  /** Who accepted, rejected or applied it, and when; null while pending. */
  decidedBy: Who | null;
  decidedAt: Date | null;
  /** The deck version the patch was written against, and the one it made. */
  baseVersion: number;
  version: number | null;
  createdAt: Date;
  /** How many operations change something (id tests not counted). */
  changes: number;
  /** For a suggestion: the deck moved on since it was made. */
  stale: boolean;
};

export type Suggestion = Revision & { patch: Operation[] };

type Row = {
  id: string;
  kind: EntryKind;
  status: Revision["status"];
  author_kind: Who;
  decided_kind: Who | null;
  decided_at: Date | null;
  base_version: number;
  version: number | null;
  created_at: Date;
  patch: Operation[];
};

const COLUMNS = `id, kind, status, author_kind, decided_kind, decided_at,
  base_version, version, created_at, patch`;

const asJson = (value: unknown) => value as postgres.JSONValue;

function toRevision(row: Row, deckVersion: number): Revision {
  return {
    id: String(row.id),
    kind: row.kind,
    status: row.status,
    author: row.author_kind,
    decidedBy: row.decided_kind,
    decidedAt: row.decided_at,
    baseVersion: row.base_version,
    version: row.version,
    createdAt: row.created_at,
    changes: row.patch.filter((op) => op.op !== "test").length,
    // A deck action does not depend on the document, so it is never stale.
    stale:
      row.kind === "edit" &&
      row.status === "suggested" &&
      row.base_version !== deckVersion,
  };
}

async function deckVersion(db: Db, owner: string, deckId: string) {
  const [deck] = await db<{ version: number }[]>`
    select version from decks
    where id = ${deckId} and owner_sub = ${owner} and deleted_at is null`;
  return deck?.version ?? null;
}

/** The deck's pending suggestions, oldest first, with their patches. */
export async function listSuggestions(
  db: Db,
  owner: string,
  deckId: string
): Promise<Suggestion[]> {
  const version = await deckVersion(db, owner, deckId);
  if (version === null) return [];
  const rows = await db<Row[]>`
    select ${db.unsafe(COLUMNS)}
    from revisions
    where deck_id = ${deckId} and status = 'suggested'
    order by id
    limit 200`;
  return rows.map((row) => ({ ...toRevision(row, version), patch: row.patch }));
}

/** The deck's history, newest first. */
export async function listRevisions(
  db: Db,
  owner: string,
  deckId: string,
  limit = 100
): Promise<Revision[]> {
  const version = await deckVersion(db, owner, deckId);
  if (version === null) return [];
  const rows = await db<Row[]>`
    select ${db.unsafe(COLUMNS)}
    from revisions
    where deck_id = ${deckId}
    order by id desc
    limit ${limit}`;
  return rows.map((row) => toRevision(row, version));
}

export type Outcome =
  | { outcome: "applied"; version: number; kind: EntryKind }
  | { outcome: "requested"; revisionId: string }
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
  | { outcome: "requested"; revisionId: string }
  | { outcome: "already" }
  | { outcome: "gone" };

/**
 * A deck action by the member or their agent, recorded as an entry. The
 * member's applies at once; an agent's applies at once too unless it is
 * risky (publish, delete), when it waits as a request.
 */
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
  if (by === "agent" && RISKY.has(action)) {
    const [entry] = await tx<{ id: string }[]>`
      insert into revisions
        (deck_id, kind, base_version, author_kind, author_sub, status)
      values (${deckId}, ${action}, ${deck.version}, 'agent', ${owner}, 'suggested')
      returning id`;
    return { outcome: "requested", revisionId: String(entry.id) };
  }
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
 * Accepts a suggestion or a request. A suggestion's patch is applied to the
 * deck as it is now; its id tests keep it to the shapes it was made for, so
 * one whose shapes moved is a conflict, and one whose change is already
 * there is "already" (marked rejected, since it has nothing left to do). A
 * request's action is carried out the same way.
 */
export async function acceptSuggestion(
  db: Db,
  owner: string,
  deckId: string,
  revisionId: string,
  by: Who = "member"
): Promise<Outcome> {
  return db.begin(async (tx) => {
    const deck = await lockDeck(tx, owner, deckId);
    if (!deck) return { outcome: "gone" };
    const [row] = await tx<{ kind: EntryKind; patch: Operation[] }[]>`
      select kind, patch from revisions
      where id = ${revisionId} and deck_id = ${deckId} and status = 'suggested'
      for update`;
    if (!row) return { outcome: "gone" };
    const settle = (status: "applied" | "rejected", version: number | null) =>
      tx`
        update revisions
        set status = ${status}, version = ${version},
            decided_kind = ${by}, decided_at = now()
        where id = ${revisionId}`;

    if (row.kind !== "edit") {
      if (!changes(deck, row.kind)) {
        await settle("rejected", null);
        return { outcome: "already" };
      }
      await applyAction(tx, deckId, row.kind);
      await settle("applied", deck.version);
      return { outcome: "applied", version: deck.version, kind: row.kind };
    }

    if (deck.deleted) return { outcome: "gone" };
    let applied;
    try {
      applied = await applyToDeck(
        tx,
        deckId,
        deck.document,
        deck.version,
        row.patch
      );
    } catch (error) {
      const outcome = conflictOf(error);
      if (outcome.outcome === "already") await settle("rejected", null);
      return outcome;
    }
    // The suggestion itself becomes the applied revision, with its inverse,
    // so the history shows the agent as its author and it can be reverted.
    await tx`
      update revisions
      set status = 'applied', version = ${applied.next},
          patch = ${tx.json(asJson(applied.result.operations))},
          inverse = ${tx.json(asJson(applied.result.inverse))},
          decided_kind = ${by}, decided_at = now()
      where id = ${revisionId}`;
    return { outcome: "applied", version: applied.next, kind: "edit" };
  });
}

/** Rejects a suggestion or request; false when there is no such pending one. */
export async function rejectSuggestion(
  db: Db,
  owner: string,
  deckId: string,
  revisionId: string,
  by: Who = "member"
): Promise<boolean> {
  const rows = await db`
    update revisions
    set status = 'rejected', decided_kind = ${by}, decided_at = now()
    where id = ${revisionId} and status = 'suggested'
      and deck_id in (select id from decks where id = ${deckId} and owner_sub = ${owner})
    returning id`;
  return rows.length > 0;
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
 * Reverts one applied entry. An edit's inverse is applied as a new edit,
 * after checking that what the edit set is still there; a deck action is
 * undone by its opposite (restore for delete, unpublish for publish), which
 * for an agent is a request when it is risky.
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
      const undo = UNDO[row.kind];
      const result = await act(tx, owner, deckId, undo, by);
      if (result.outcome === "applied") {
        return { outcome: "applied", version: deck.version, kind: undo };
      }
      return result.outcome === "requested"
        ? { outcome: "requested", revisionId: result.revisionId }
        : result;
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
