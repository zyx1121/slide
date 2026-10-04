// Comments on a selection (PLAN.md, Agents). The member, or an agent, writes
// a comment on slides, shapes or words; anyone replies, resolves or reopens
// it. Every one of those is a row of its own, kept for good, so a thread is
// its whole conversation. Every query is scoped to the deck's owner.
import type postgres from "postgres";
import * as z from "zod";

import type { Who } from "./revisions";
import type { DeckDocument } from "./schema";
import { Target } from "./selection";

type Db = postgres.Sql;

export const COMMENT_MAX = 5000;

export const Body = z
  .string()
  .trim()
  .min(1)
  .max(COMMENT_MAX)
  // Postgres cannot store U+0000 in text.
  .refine((value) => !value.includes("\u0000"), "a comment cannot hold U+0000");

export const CommentInput = z.strictObject({
  slideId: z.string().regex(/^[a-z]+_[0-9a-z_-]{2,48}$/),
  targets: z.array(Target).max(1000),
  body: Body,
});

export type Reply = {
  id: string;
  kind: "reply" | "resolve" | "reopen";
  author: Who;
  body: string;
  /** The change of the deck's history it points at. */
  entryId: string | null;
  createdAt: Date;
};

export type Thread = {
  id: string;
  author: Who;
  body: string;
  slideId: string;
  targets: Target[];
  status: "open" | "resolved";
  createdAt: Date;
  replies: Reply[];
};

type Row = {
  id: string;
  thread_id: string | null;
  kind: "comment" | Reply["kind"];
  author_kind: Who;
  slide_id: string | null;
  targets: Target[];
  body: string;
  entry_id: string | null;
  created_at: Date;
};

/** The owner's live deck, locked for the transaction; null when it is not there. */
async function lockDeck(
  tx: postgres.TransactionSql,
  owner: string,
  deckId: string
) {
  const [deck] = await tx<{ document: DeckDocument }[]>`
    select document from decks
    where id = ${deckId} and owner_sub = ${owner} and deleted_at is null
    for update`;
  return deck ?? null;
}

export type CommentResult =
  | { outcome: "added"; id: string }
  | { outcome: "unchanged" }
  | { outcome: "gone" }
  | { outcome: "invalid"; message: string };

/**
 * Starts a thread on a slide and the shapes selected on it. Shapes must be
 * on the slide; a text range says which words.
 */
export async function addComment(
  db: Db,
  owner: string,
  deckId: string,
  input: z.infer<typeof CommentInput>,
  by: Who = "member"
): Promise<CommentResult> {
  return db.begin(async (tx) => {
    const deck = await lockDeck(tx, owner, deckId);
    if (!deck) return { outcome: "gone" };
    const slide = deck.document.slides.find((s) => s.id === input.slideId);
    if (!slide) {
      return { outcome: "invalid", message: `no slide ${input.slideId}` };
    }
    const shapes = new Set(slide.shapes.map((shape) => shape.id));
    const stray = input.targets.find((target) => !shapes.has(target.shape));
    if (stray) {
      return {
        outcome: "invalid",
        message: `no shape ${stray.shape} on slide ${input.slideId}`,
      };
    }
    const [row] = await tx<{ id: string }[]>`
      insert into comments
        (deck_id, kind, author_kind, author_sub, slide_id, targets, body)
      values (${deckId}, 'comment', ${by}, ${owner}, ${input.slideId},
        ${tx.json(input.targets as postgres.JSONValue)}, ${input.body})
      returning id`;
    return { outcome: "added", id: String(row.id) };
  });
}

/** The thread's status as its latest resolve or reopen left it. */
async function statusOf(
  tx: postgres.TransactionSql,
  threadId: string
): Promise<Thread["status"]> {
  const [last] = await tx<{ kind: string }[]>`
    select kind from comments
    where thread_id = ${threadId} and kind in ('resolve', 'reopen')
    order by id desc limit 1`;
  return last?.kind === "resolve" ? "resolved" : "open";
}

/**
 * Adds to a thread: a reply (optionally pointing at an entry of the deck's
 * history, such as the edit that answers it), or a resolve or reopen.
 * Resolving a resolved thread, or reopening an open one, changes nothing.
 */
export async function addToThread(
  db: Db,
  owner: string,
  deckId: string,
  threadId: string,
  input: {
    kind: Reply["kind"];
    body?: string;
    entryId?: string;
  },
  by: Who = "member"
): Promise<CommentResult> {
  return db.begin(async (tx) => {
    const deck = await lockDeck(tx, owner, deckId);
    if (!deck) return { outcome: "gone" };
    const [thread] = await tx`
      select 1 from comments
      where id = ${threadId} and deck_id = ${deckId} and kind = 'comment'`;
    if (!thread) return { outcome: "gone" };
    if (input.kind === "reply" && !input.body?.trim()) {
      return { outcome: "invalid", message: "a reply needs a body" };
    }
    if (input.kind !== "reply") {
      const status = await statusOf(tx, threadId);
      if ((input.kind === "resolve") === (status === "resolved")) {
        return { outcome: "unchanged" };
      }
    }
    if (input.entryId) {
      const [entry] = await tx`
        select 1 from revisions
        where id = ${input.entryId} and deck_id = ${deckId}`;
      if (!entry) {
        return { outcome: "invalid", message: `no entry ${input.entryId}` };
      }
    }
    const [row] = await tx<{ id: string }[]>`
      insert into comments
        (deck_id, thread_id, kind, author_kind, author_sub, body, entry_id)
      values (${deckId}, ${threadId}, ${input.kind}, ${by}, ${owner},
        ${input.body?.trim() ?? ""}, ${input.entryId ?? null})
      returning id`;
    return { outcome: "added", id: String(row.id) };
  });
}

/**
 * The deck's threads, oldest first, each with everything added to it.
 * `status` keeps only open or only resolved ones.
 */
export async function listThreads(
  db: Db,
  owner: string,
  deckId: string,
  options: { status?: Thread["status"]; limit?: number } = {}
): Promise<Thread[]> {
  const rows = await db<Row[]>`
    select c.id, c.thread_id, c.kind, c.author_kind, c.slide_id, c.targets,
      c.body, c.entry_id, c.created_at
    from comments c
    join decks d on d.id = c.deck_id
    where c.deck_id = ${deckId} and d.owner_sub = ${owner}
      and d.deleted_at is null
    order by c.id`;
  const threads = new Map<string, Thread>();
  for (const row of rows) {
    if (row.kind === "comment") {
      threads.set(String(row.id), {
        id: String(row.id),
        author: row.author_kind,
        body: row.body,
        slideId: row.slide_id!,
        targets: row.targets,
        status: "open",
        createdAt: row.created_at,
        replies: [],
      });
      continue;
    }
    const thread = threads.get(String(row.thread_id));
    if (!thread) continue;
    if (row.kind === "resolve") thread.status = "resolved";
    if (row.kind === "reopen") thread.status = "open";
    thread.replies.push({
      id: String(row.id),
      kind: row.kind,
      author: row.author_kind,
      body: row.body,
      entryId: row.entry_id === null ? null : String(row.entry_id),
      createdAt: row.created_at,
    });
  }
  const all = [...threads.values()].filter(
    (thread) => !options.status || thread.status === options.status
  );
  return options.limit ? all.slice(-options.limit) : all;
}
