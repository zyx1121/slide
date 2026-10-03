// The single write path for decks (PLAN.md, Rules 1 to 3). Every read and
// write is scoped to the member who owns the deck; an agent acts for its
// member and its writes land as suggestions.
import type postgres from "postgres";

import { newId } from "../ids";
import { DeckError } from "./errors";
import { applyOperations, type Operation } from "./patch";
import { DeckDocument, SCHEMA_VERSION, type Slide } from "./schema";

type Db = postgres.Sql;

export type Actor = {
  kind: "member" | "agent";
  /** The member's Keycloak subject; an agent carries its member's. */
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
};

export type MutationResult = {
  status: "applied" | "suggested";
  /** The deck's version after the write; unchanged for a suggestion. */
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

/** A deck with one empty slide. */
export function blankDocument(title = DEFAULT_TITLE): DeckDocument {
  return DeckDocument.parse({
    schema: SCHEMA_VERSION,
    title,
    slides: [{ id: newId("sl"), title: "", shapes: [] }],
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
    })[]
  >`
    select id, title, version, published, updated_at,
      jsonb_array_length(document -> 'slides') as slide_count,
      document -> 'slides' -> 0 as first_slide
    from decks
    where owner_sub = ${owner}
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
  }));
}

/** The deck, or null when it does not exist or belongs to someone else. */
export async function getDeck(
  db: Db,
  owner: string,
  id: string
): Promise<Deck | null> {
  const [row] = await db<DeckRow[]>`
    select * from decks where id = ${id} and owner_sub = ${owner}
  `;
  return row ? toDeck(row) : null;
}

/**
 * Publishes or unpublishes a member's deck. The public id is made on the
 * first publish and kept, so publishing again brings the same link back.
 * Publishing changes no part of the document, so it writes no revision.
 * Null when the deck is missing or not the member's.
 */
export async function setPublished(
  db: Db,
  owner: string,
  id: string,
  published: boolean
): Promise<{ published: boolean; publicId: string | null } | null> {
  const [row] = await db<Pick<DeckRow, "published" | "public_id">[]>`
    update decks
    set published = ${published},
        public_id = coalesce(public_id, ${newPublicId()})
    where id = ${id} and owner_sub = ${owner}
    returning published, public_id
  `;
  return row ? { published: row.published, publicId: row.public_id } : null;
}

/** A public id: 16 characters, about 79 bits, so links cannot be guessed. */
function newPublicId(): string {
  return newId("p", 16).slice(2);
}

/** A published deck by its public id, for anyone with the link. */
export async function getPublishedDeck(
  db: Db,
  publicId: string
): Promise<Deck | null> {
  if (!/^[0-9a-z]{16}$/.test(publicId)) return null;
  const [row] = await db<DeckRow[]>`
    select * from decks where public_id = ${publicId} and published
  `;
  return row ? toDeck(row) : null;
}

/**
 * Applies a JSON Patch written against `baseVersion`. A member's patch is
 * applied and bumps the version; an agent's patch is checked the same way and
 * stored as a suggestion, leaving the deck unchanged. Throws DeckError when
 * the deck is missing or not the actor's ("not_found"), the version moved on
 * ("conflict"), or the patch or its result is invalid.
 */
export async function mutateDeck(
  db: Db,
  input: { deckId: string; actor: Actor; baseVersion: number; ops: unknown }
): Promise<MutationResult> {
  const { deckId, actor, baseVersion } = input;
  return db.begin(async (tx) => {
    const [row] = await tx<Pick<DeckRow, "document" | "version">[]>`
      select document, version from decks
      where id = ${deckId} and owner_sub = ${actor.sub}
      for update
    `;
    if (!row) throw new DeckError("not_found", `no deck ${deckId}`);
    if (row.version !== baseVersion) {
      throw new DeckError(
        "conflict",
        `deck ${deckId} is at version ${row.version}; the patch was written against ${baseVersion}`,
        { currentVersion: row.version }
      );
    }

    const result = applyOperations(row.document, input.ops);

    if (actor.kind === "agent") {
      const [revision] = await tx<{ id: string }[]>`
        insert into revisions
          (deck_id, base_version, author_kind, author_sub, status, patch)
        values
          (${deckId}, ${baseVersion}, 'agent', ${actor.sub}, 'suggested',
           ${tx.json(asJson(result.operations))})
        returning id
      `;
      return {
        status: "suggested",
        version: row.version,
        revisionId: String(revision.id),
      };
    }

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
        (deck_id, base_version, version, author_kind, author_sub, status, patch, inverse)
      values
        (${deckId}, ${baseVersion}, ${version}, 'member', ${actor.sub}, 'applied',
         ${tx.json(asJson(result.operations))}, ${tx.json(asJson(result.inverse))})
      returning id
    `;
    return { status: "applied", version, revisionId: String(revision.id) };
  });
}

/**
 * Renames a deck. The rename is a member's patch like any other edit, so it
 * gets a revision and can be reverted. It does not depend on the rest of the
 * document, so it is written against the deck's current version, and tried
 * again if another write lands in between. Returns false when the deck is
 * missing or someone else's; renaming to the same title changes nothing.
 */
export async function renameDeck(
  db: Db,
  owner: string,
  id: string,
  title: string
): Promise<boolean> {
  const value = title.trim();
  for (let attempt = 1; ; attempt++) {
    const [row] = await db<Pick<DeckRow, "title" | "version">[]>`
      select title, version from decks where id = ${id} and owner_sub = ${owner}
    `;
    if (!row) return false;
    if (row.title === value) return true;
    try {
      await mutateDeck(db, {
        deckId: id,
        actor: { kind: "member", sub: owner },
        baseVersion: row.version,
        ops: [{ op: "replace", path: "/title", value }],
      });
      return true;
    } catch (error) {
      if (error instanceof DeckError && error.code === "not_found") {
        return false;
      }
      if (error instanceof DeckError && error.code === "conflict") {
        if (attempt < 3) continue;
      }
      throw error;
    }
  }
}

/**
 * Deletes a deck with its revisions. Returns false when the deck is missing
 * or someone else's.
 */
export async function deleteDeck(
  db: Db,
  owner: string,
  id: string
): Promise<boolean> {
  const rows = await db`
    delete from decks where id = ${id} and owner_sub = ${owner} returning id
  `;
  return rows.length > 0;
}

export type { Operation };
