// Suggestions and history (PLAN.md, Rule 2). An agent's edit waits as a
// suggested revision until the member accepts or rejects it; every applied
// revision can be reverted on its own while nothing later touched what it
// changed. Every query is scoped to the deck's owner.
import type postgres from "postgres";

import { DeckError } from "./errors";
import { applyOperations, type Operation } from "./patch";
import type { DeckDocument } from "./schema";

type Db = postgres.Sql;

export type Revision = {
  id: string;
  status: "applied" | "suggested" | "rejected";
  author: "member" | "agent";
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
  status: Revision["status"];
  author_kind: Revision["author"];
  base_version: number;
  version: number | null;
  created_at: Date;
  patch: Operation[];
};

const asJson = (value: unknown) => value as postgres.JSONValue;

function toRevision(row: Row, deckVersion: number): Revision {
  return {
    id: String(row.id),
    status: row.status,
    author: row.author_kind,
    baseVersion: row.base_version,
    version: row.version,
    createdAt: row.created_at,
    changes: row.patch.filter((op) => op.op !== "test").length,
    stale: row.status === "suggested" && row.base_version !== deckVersion,
  };
}

async function deckVersion(db: Db, owner: string, deckId: string) {
  const [deck] = await db<{ version: number }[]>`
    select version from decks where id = ${deckId} and owner_sub = ${owner}`;
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
    select id, status, author_kind, base_version, version, created_at, patch
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
    select id, status, author_kind, base_version, version, created_at, patch
    from revisions
    where deck_id = ${deckId}
    order by id desc
    limit ${limit}`;
  return rows.map((row) => toRevision(row, version));
}

export type Outcome =
  | { outcome: "applied"; version: number }
  | { outcome: "already" }
  | { outcome: "conflict"; message: string }
  | { outcome: "gone" };

/** Applies a patch to the locked deck as the member; the deck's new version. */
async function applyToDeck(
  tx: postgres.TransactionSql,
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

/**
 * Accepts a suggestion: its patch is applied to the deck as it is now. Its
 * id tests keep it to the shapes it was made for, so a suggestion whose
 * shapes moved is a conflict, and one whose change is already there is
 * "already" (marked rejected, since it has nothing left to do).
 */
export async function acceptSuggestion(
  db: Db,
  owner: string,
  deckId: string,
  revisionId: string
): Promise<Outcome> {
  return db.begin(async (tx) => {
    const [deck] = await tx<{ document: DeckDocument; version: number }[]>`
      select document, version from decks
      where id = ${deckId} and owner_sub = ${owner}
      for update`;
    if (!deck) return { outcome: "gone" };
    const [row] = await tx<{ patch: Operation[] }[]>`
      select patch from revisions
      where id = ${revisionId} and deck_id = ${deckId} and status = 'suggested'
      for update`;
    if (!row) return { outcome: "gone" };
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
      if (outcome.outcome === "already") {
        await tx`update revisions set status = 'rejected' where id = ${revisionId}`;
      }
      return outcome;
    }
    // The suggestion itself becomes the applied revision, with its inverse,
    // so the history shows the agent as its author and it can be reverted.
    await tx`
      update revisions
      set status = 'applied', version = ${applied.next},
          patch = ${tx.json(asJson(applied.result.operations))},
          inverse = ${tx.json(asJson(applied.result.inverse))}
      where id = ${revisionId}`;
    return { outcome: "applied", version: applied.next };
  });
}

/** Rejects a suggestion; false when there is no such pending suggestion. */
export async function rejectSuggestion(
  db: Db,
  owner: string,
  deckId: string,
  revisionId: string
): Promise<boolean> {
  const rows = await db`
    update revisions set status = 'rejected'
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
 * Reverts one applied revision: its inverse is applied as a new edit of the
 * member's, after checking that what the revision set is still there.
 */
export async function revertRevision(
  db: Db,
  owner: string,
  deckId: string,
  revisionId: string
): Promise<Outcome> {
  return db.begin(async (tx) => {
    const [deck] = await tx<{ document: DeckDocument; version: number }[]>`
      select document, version from decks
      where id = ${deckId} and owner_sub = ${owner}
      for update`;
    if (!deck) return { outcome: "gone" };
    const [row] = await tx<
      { patch: Operation[]; inverse: Operation[] | null }[]
    >`
      select patch, inverse from revisions
      where id = ${revisionId} and deck_id = ${deckId} and status = 'applied'`;
    if (!row?.inverse?.length) return { outcome: "gone" };
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
        (deck_id, base_version, version, author_kind, author_sub, status, patch, inverse)
      values
        (${deckId}, ${deck.version}, ${applied.next}, 'member', ${owner}, 'applied',
         ${tx.json(asJson(applied.result.operations))},
         ${tx.json(asJson(applied.result.inverse))})`;
    return { outcome: "applied", version: applied.next };
  });
}
