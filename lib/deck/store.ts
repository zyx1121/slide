// The single write path for decks (PLAN.md, Rules 1 to 3). Every read and
// write is scoped to the member who owns the deck; an agent acts for its
// member. Every write, the member's or an agent's, applies at once and is
// recorded in the deck's history, where it can be reverted.
import type postgres from "postgres";

import { newId } from "../ids";
import { blankSlide } from "../editor/slides";
import { BUILTIN_MASTERS, layoutOf } from "../master/layout";
import { DeckError } from "./errors";
import { applyOperations, type Operation } from "./patch";
import { actOnDeck } from "./revisions";
import {
  DeckDocument,
  type Layout,
  type Master,
  SCHEMA_VERSION,
  type Slide,
} from "./schema";

type Db = postgres.Sql;

export type Actor = {
  kind: "member" | "agent";
  /** The member's sign-in subject; an agent carries its member's. */
  sub: string;
};

export type Deck = {
  id: string;
  ownerSub: string;
  title: string;
  document: DeckDocument;
  version: number;
  published: boolean;
  publicId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DeckSummary = Pick<
  Deck,
  "id" | "title" | "version" | "published" | "updatedAt"
> & {
  slideCount: number;
  /** The first slide, drawn as the deck's thumbnail. */
  firstSlide: Slide;
  /** The layout the first slide is drawn on. */
  firstLayout: Layout;
};

export type MutationResult = {
  status: "applied";
  /** The deck's version after the write. */
  version: number;
  revisionId: string;
};

type DeckRow = {
  id: string;
  owner_sub: string;
  title: string;
  document: DeckDocument;
  version: number;
  published: boolean;
  public_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const DEFAULT_TITLE = "未命名簡報";

/** postgres.js types jsonb parameters as JSONValue; documents are plain JSON. */
function asJson(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue;
}

function toDeck(row: DeckRow): Deck {
  return {
    id: row.id,
    ownerSub: row.owner_sub,
    title: row.title,
    document: row.document,
    version: row.version,
    published: row.published,
    publicId: row.public_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Records a member on sign-in and keeps their name and email current. */
export async function ensureUser(
  db: Db,
  user: { sub: string; name?: string; email?: string }
): Promise<void> {
  await db`
    insert into users (sub, name, email)
    values (${user.sub}, ${user.name ?? ""}, ${user.email ?? ""})
    on conflict (sub) do update
      set name = excluded.name, email = excluded.email, last_seen_at = now()
  `;
}

/**
 * A deck of one slide on the master's default layout, its placeholders
 * empty; on the plain master unless given another.
 */
export function blankDocument(
  title = DEFAULT_TITLE,
  master: Master = BUILTIN_MASTERS.plain
): DeckDocument {
  return DeckDocument.parse({
    schema: SCHEMA_VERSION,
    title,
    master,
    slides: [blankSlide(layoutOf({ master }, undefined))],
  });
}

export async function createDeck(
  db: Db,
  owner: string,
  document: DeckDocument = blankDocument()
): Promise<Deck> {
  const valid = DeckDocument.parse(document);
  const [row] = await db<DeckRow[]>`
    insert into decks (id, owner_sub, title, document)
    values (${newId("dk", 10)}, ${owner}, ${valid.title}, ${db.json(asJson(valid))})
    returning *
  `;
  return toDeck(row);
}

export async function listDecks(db: Db, owner: string): Promise<DeckSummary[]> {
  const rows = await db<
    (Pick<DeckRow, "id" | "title" | "version" | "published" | "updated_at"> & {
      slide_count: number;
      first_slide: Slide;
      first_layout: Layout;
      master_shapes: Master["shapes"];
    })[]
  >`
    select id, title, version, published, updated_at,
      jsonb_array_length(document -> 'slides') as slide_count,
      document -> 'slides' -> 0 as first_slide,
      document -> 'master' -> 'layouts' -> coalesce(
        (document -> 'slides' -> 0 ->> 'layout')::int,
        (document -> 'master' ->> 'layout')::int
      ) as first_layout,
      document -> 'master' -> 'shapes' as master_shapes
    from decks
    where owner_sub = ${owner} and deleted_at is null
    order by updated_at desc
  `;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    version: row.version,
    published: row.published,
    updatedAt: row.updated_at,
    slideCount: row.slide_count,
    firstSlide: row.first_slide,
    firstLayout: layoutOf(
      {
        master: {
          ...BUILTIN_MASTERS.plain,
          shapes: row.master_shapes,
          layouts: [row.first_layout],
          layout: 0,
        },
      },
      undefined
    ),
  }));
}

/** The deck, or null when it does not exist or belongs to someone else. */
export async function getDeck(
  db: Db,
  owner: string,
  id: string
): Promise<Deck | null> {
  const [row] = await db<DeckRow[]>`
    select * from decks
    where id = ${id} and owner_sub = ${owner} and deleted_at is null
  `;
  return row ? toDeck(row) : null;
}

/** A published deck by its public id, for anyone with the link. */
export async function getPublishedDeck(
  db: Db,
  publicId: string
): Promise<Deck | null> {
  if (!/^[0-9a-z]{16}$/.test(publicId)) return null;
  const [row] = await db<DeckRow[]>`
    select * from decks
    where public_id = ${publicId} and published and deleted_at is null
  `;
  return row ? toDeck(row) : null;
}

/**
 * A member's live deck's version and whether it is published, cheaply,
 * without its document; null when there is no such deck.
 */
export async function deckStatus(
  db: Db,
  owner: string,
  id: string
): Promise<{
  version: number;
  published: boolean;
  publicId: string | null;
} | null> {
  const [row] = await db<
    Pick<DeckRow, "version" | "published" | "public_id">[]
  >`
    select version, published, public_id from decks
    where id = ${id} and owner_sub = ${owner} and deleted_at is null
  `;
  return row
    ? {
        version: row.version,
        published: row.published,
        publicId: row.public_id,
      }
    : null;
}

/**
 * Applies a JSON Patch to the actor's deck, bumps the version and records
 * it, with its inverse, as an entry of the deck's history under its author.
 * The patch is either written against `baseVersion` (the editor's saves,
 * refused as a "conflict" when the deck moved on), or planned on the deck as
 * it is while its row is held, so nothing can land in between (an agent's
 * edits and renames, which address shapes by id). Throws DeckError when the
 * deck is missing or not the actor's ("not_found") or the patch or its
 * result is invalid; a plan's own errors pass through.
 */
export async function mutateDeck(
  db: Db,
  input: { deckId: string; actor: Actor } & (
    | { baseVersion: number; ops: unknown }
    | { plan: (document: DeckDocument) => Operation[] }
  )
): Promise<MutationResult> {
  const { deckId, actor } = input;
  return db.begin(async (tx) => {
    const [row] = await tx<Pick<DeckRow, "document" | "version">[]>`
      select document, version from decks
      where id = ${deckId} and owner_sub = ${actor.sub} and deleted_at is null
      for update
    `;
    if (!row) throw new DeckError("not_found", `no deck ${deckId}`);
    let ops: unknown;
    if ("plan" in input) {
      ops = input.plan(row.document);
    } else if (row.version !== input.baseVersion) {
      throw new DeckError(
        "conflict",
        `deck ${deckId} is at version ${row.version}; the patch was written against ${input.baseVersion}`
      );
    } else {
      ops = input.ops;
    }

    const result = applyOperations(row.document, ops);
    const version = row.version + 1;
    await tx`
      update decks
      set document = ${tx.json(asJson(result.document))},
          title = ${result.document.title},
          version = ${version},
          updated_at = now()
      where id = ${deckId}
    `;
    const [revision] = await tx<{ id: string }[]>`
      insert into revisions
        (deck_id, base_version, version, author_kind, author_sub, status,
         patch, inverse)
      values
        (${deckId}, ${row.version}, ${version}, ${actor.kind}, ${actor.sub}, 'applied',
         ${tx.json(asJson(result.operations))}, ${tx.json(asJson(result.inverse))})
      returning id
    `;
    return { status: "applied", version, revisionId: String(revision.id) };
  });
}

/**
 * Renames a deck. The rename is a member's patch like any other edit, so it
 * gets a revision and can be reverted. It is planned on the deck as it is
 * while its row is held, so another write in between cannot refuse it.
 * Returns false when the deck is missing or someone else's; renaming to the
 * same title changes nothing.
 */
export async function renameDeck(
  db: Db,
  owner: string,
  id: string,
  title: string
): Promise<boolean> {
  const value = title.trim();
  try {
    await mutateDeck(db, {
      deckId: id,
      actor: { kind: "member", sub: owner },
      plan: () => [{ op: "replace", path: "/title", value }],
    });
    return true;
  } catch (error) {
    if (!(error instanceof DeckError)) throw error;
    if (error.code === "not_found") return false;
    // Already that title: there was nothing to change.
    if (error.message === "the patch changes nothing") return true;
    throw error;
  }
}

/**
 * Deletes a member's deck: it leaves the lists but stays, with its
 * history, and an entry in that history restores it. Returns false when the
 * deck is missing, someone else's, or already deleted.
 */
export async function deleteDeck(
  db: Db,
  owner: string,
  id: string
): Promise<boolean> {
  return (await actOnDeck(db, owner, id, "delete")).outcome === "applied";
}

/** Brings a deleted deck back; false when there is none to restore. */
export async function restoreDeck(
  db: Db,
  owner: string,
  id: string
): Promise<boolean> {
  return (await actOnDeck(db, owner, id, "restore")).outcome === "applied";
}

/** The member's deleted decks, most recently deleted first. */
export async function listDeletedDecks(
  db: Db,
  owner: string
): Promise<{ id: string; title: string; deletedAt: Date }[]> {
  const rows = await db<{ id: string; title: string; deleted_at: Date }[]>`
    select id, title, deleted_at from decks
    where owner_sub = ${owner} and deleted_at is not null
    order by deleted_at desc
    limit 50
  `;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    deletedAt: row.deleted_at,
  }));
}

export type { Operation };
