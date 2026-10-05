import { compare } from "fast-json-patch";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addSlide,
  copySlide,
  deleteShapes,
  setSlideLayout,
  setSlideNotes,
  setSlideTitle,
  updateShapes,
} from "../mcp/write";
import type { Operation } from "./patch";
import type { DeckDocument } from "./schema";
import { createTestDb, TEST_DATABASE_URL } from "../test-db";
import { actOnDeck, listRevisions, revertRevision } from "./revisions";
import { sampleDocument } from "./sample";
import { createDeck, ensureUser, getDeck, mutateDeck } from "./store";

describe.skipIf(!TEST_DATABASE_URL)("history (Postgres)", () => {
  let db: postgres.Sql;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await ensureUser(db, { sub: "alice" });
    await ensureUser(db, { sub: "bob" });
  });
  afterAll(async () => {
    await drop?.();
  });

  async function fresh() {
    return createDeck(db, "alice", sampleDocument());
  }
  async function agentEdit(deckId: string, set: Record<string, unknown>) {
    const deck = (await getDeck(db, "alice", deckId))!;
    const plan = updateShapes(deck.document, 1, [{ id: "sh_asr", set }]);
    const result = await mutateDeck(db, {
      deckId,
      actor: { kind: "agent", sub: "alice" },
      baseVersion: deck.version,
      ops: plan.ops,
    });
    return result.revisionId;
  }
  async function edit(deckId: string, set: Record<string, unknown>) {
    const deck = (await getDeck(db, "alice", deckId))!;
    const plan = updateShapes(deck.document, 1, [{ id: "sh_asr", set }]);
    return mutateDeck(db, {
      deckId,
      actor: { kind: "member", sub: "alice" },
      baseVersion: deck.version,
      ops: plan.ops,
    });
  }
  const asr = async (deckId: string) =>
    (await getDeck(db, "alice", deckId))!.document.slides[0].shapes.find(
      (shape) => shape.id === "sh_asr"
    ) as { fill?: string; x: number };

  it("applies an agent's edit at once, as the agent's entry, and reverts it", async () => {
    const deck = await fresh();
    const id = await agentEdit(deck.id, { fill: "#fff2cc" });
    expect((await asr(deck.id)).fill).toBe("#fff2cc");
    const [latest] = await listRevisions(db, "alice", deck.id);
    expect(latest).toMatchObject({
      id,
      kind: "edit",
      status: "applied",
      author: "agent",
      version: 1,
      changes: 1,
    });
    expect(await listRevisions(db, "bob", deck.id)).toEqual([]);
    // Another member cannot revert it; the member can.
    expect(await revertRevision(db, "bob", deck.id, id)).toEqual({
      outcome: "gone",
    });
    expect(await revertRevision(db, "alice", deck.id, id)).toMatchObject({
      outcome: "applied",
      kind: "edit",
    });
    expect((await asr(deck.id)).fill).not.toBe("#fff2cc");
  });

  it("does not revert a suggestion that was never taken", async () => {
    const deck = await fresh();
    const [row] = await db<{ id: string }[]>`
        insert into revisions
          (deck_id, base_version, author_kind, author_sub, status, patch)
        values (${deck.id}, 0, 'agent', 'alice', 'rejected', '[]'::jsonb)
        returning id`;
    expect(await revertRevision(db, "alice", deck.id, String(row.id))).toEqual({
      outcome: "gone",
    });
  });

  it("reverts one revision, unless a later edit changed the same place", async () => {
    const deck = await fresh();
    const before = (await asr(deck.id)).x;
    const first = await edit(deck.id, { x: 111 });
    await edit(deck.id, { fill: "#ffc000" });
    expect(
      await revertRevision(db, "alice", deck.id, first.revisionId)
    ).toMatchObject({
      outcome: "applied",
    });
    expect(await asr(deck.id)).toMatchObject({ x: before, fill: "#ffc000" });

    const moved = await edit(deck.id, { x: 222 });
    await edit(deck.id, { x: 333 });
    expect(
      await revertRevision(db, "alice", deck.id, moved.revisionId)
    ).toMatchObject({
      outcome: "conflict",
    });
    expect((await asr(deck.id)).x).toBe(333);
  });

  /** Applies a planned edit as the member; returns its entry. */
  async function planned(
    deckId: string,
    plan: (document: DeckDocument) => Operation[]
  ) {
    const result = await mutateDeck(db, {
      deckId,
      actor: { kind: "member", sub: "alice" },
      plan,
    });
    return result.revisionId;
  }
  const documentOf = async (deckId: string) =>
    (await getDeck(db, "alice", deckId))!.document;

  it("keeps later edits to shapes an entry moved, when it is reverted", async () => {
    // A shape deleted, one after it edited, the deletion reverted.
    const deck = await fresh();
    const removed = await planned(
      deck.id,
      (d) => deleteShapes(d, 1, ["sh_capture"]).ops
    );
    await edit(deck.id, { fill: "#fff2cc" });
    expect(await revertRevision(db, "alice", deck.id, removed)).toMatchObject({
      outcome: "applied",
    });
    const after = await documentOf(deck.id);
    expect(after.slides[0].shapes.map((shape) => shape.id)).toEqual(
      deck.document.slides[0].shapes.map((shape) => shape.id)
    );
    expect((await asr(deck.id)).fill).toBe("#fff2cc");
  });

  it("keeps a later edit to a slide a copy moved, when the copy is reverted", async () => {
    const deck = await fresh();
    await planned(deck.id, (d) => addSlide(d, { title: "Second" }).ops);
    const copied = await planned(deck.id, (d) => copySlide(d, 1).ops);
    await planned(deck.id, (d) => setSlideTitle(d, 3, "Second, renamed").ops);
    expect(await revertRevision(db, "alice", deck.id, copied)).toMatchObject({
      outcome: "applied",
    });
    expect(
      (await documentOf(deck.id)).slides.map((slide) => slide.title)
    ).toEqual(["System overview", "Second, renamed"]);
  });

  it("keeps a later edit on a slide whose layout change is reverted", async () => {
    const deck = await fresh();
    const relaid = await planned(
      deck.id,
      (d) => setSlideLayout(d, 1, "Two Columns").ops
    );
    expect(
      (await documentOf(deck.id)).slides[0].shapes
        .slice(0, 2)
        .map((shape) => (shape.kind === "text" ? shape.placeholder : undefined))
    ).toEqual(["1", "21"]);
    await edit(deck.id, { fill: "#fff2cc" });
    expect(await revertRevision(db, "alice", deck.id, relaid)).toMatchObject({
      outcome: "applied",
    });
    const after = await documentOf(deck.id);
    expect(after.slides[0].layout).toBeUndefined();
    expect(after.slides[0].shapes.map((shape) => shape.id)).toEqual(
      deck.document.slides[0].shapes.map((shape) => shape.id)
    );
    expect((await asr(deck.id)).fill).toBe("#fff2cc");
  });

  it("reverts on the shape the edit changed, wherever it is now", async () => {
    const deck = await fresh();
    const original = (await asr(deck.id)).fill;
    const { revisionId: red } = await edit(deck.id, { fill: "#ff0000" });
    // Later, another shape gets the same fill, and a shape before both goes.
    await planned(
      deck.id,
      (d) =>
        updateShapes(d, 1, [{ id: "sh_router", set: { fill: "#ff0000" } }]).ops
    );
    await planned(deck.id, (d) => deleteShapes(d, 1, ["sh_capture"]).ops);
    expect(await revertRevision(db, "alice", deck.id, red)).toMatchObject({
      outcome: "applied",
    });
    const shapes = (await documentOf(deck.id)).slides[0].shapes as {
      id: string;
      fill?: string;
    }[];
    expect(shapes.find((shape) => shape.id === "sh_asr")?.fill).toBe(original);
    expect(shapes.find((shape) => shape.id === "sh_router")?.fill).toBe(
      "#ff0000"
    );
  });

  it("does not put back what a later edit set again", async () => {
    const deck = await fresh();
    await planned(deck.id, (d) => setSlideNotes(d, 1, "old notes").ops);
    const cleared = await planned(deck.id, (d) => setSlideNotes(d, 1, "").ops);
    await planned(deck.id, (d) => setSlideNotes(d, 1, "new notes").ops);
    expect(await revertRevision(db, "alice", deck.id, cleared)).toMatchObject({
      outcome: "conflict",
    });
    expect((await documentOf(deck.id)).slides[0].notes).toBe("new notes");

    // A shape's text taken away, then written again.
    const emptied = await planned(
      deck.id,
      (d) => updateShapes(d, 1, [{ id: "sh_asr", set: { text: null } }]).ops
    );
    const later = { paragraphs: [{ runs: [{ text: "Later" }] }] };
    await planned(
      deck.id,
      (d) => updateShapes(d, 1, [{ id: "sh_asr", set: { text: later } }]).ops
    );
    expect(await revertRevision(db, "alice", deck.id, emptied)).toMatchObject({
      outcome: "conflict",
    });
    expect(await asr(deck.id)).toMatchObject({ text: later });

    // With nothing set since, it is put back.
    await planned(deck.id, (d) => setSlideNotes(d, 1, "kept").ops);
    const gone = await planned(deck.id, (d) => setSlideNotes(d, 1, "").ops);
    expect(await revertRevision(db, "alice", deck.id, gone)).toMatchObject({
      outcome: "applied",
    });
    expect((await documentOf(deck.id)).slides[0].notes).toBe("kept");
  });

  it("reverts an entry stored before inverses were guarded", async () => {
    const deck = await fresh();
    const { revisionId } = await edit(deck.id, { x: 444 });
    const [stored] = await db<{ inverse_guarded: boolean }[]>`
      select inverse_guarded from revisions where id = ${revisionId}`;
    expect(stored.inverse_guarded).toBe(true);
    // As one was stored then: the whole-document difference, unguarded.
    const older = compare(await documentOf(deck.id), deck.document);
    await db`
      update revisions
      set inverse = ${db.json(JSON.parse(JSON.stringify(older)))},
          inverse_guarded = false
      where id = ${revisionId}`;
    expect(
      await revertRevision(db, "alice", deck.id, revisionId)
    ).toMatchObject({ outcome: "applied" });
    expect(await documentOf(deck.id)).toEqual(deck.document);
  });

  it("publishes and deletes for an agent at once, each undone by its opposite", async () => {
    const deck = await fresh();
    const published = await actOnDeck(db, "alice", deck.id, "publish", "agent");
    expect(published.outcome).toBe("applied");
    expect((await getDeck(db, "alice", deck.id))!.published).toBe(true);
    expect(await actOnDeck(db, "alice", deck.id, "publish", "agent")).toEqual({
      outcome: "already",
    });

    const deleted = await actOnDeck(db, "alice", deck.id, "delete", "agent");
    expect(deleted.outcome).toBe("applied");
    expect(await getDeck(db, "alice", deck.id)).toBeNull();

    // A deck action is not reverted: its opposite undoes it.
    const deletedId = (deleted as { revisionId: string }).revisionId;
    expect(await revertRevision(db, "alice", deck.id, deletedId)).toMatchObject(
      { outcome: "conflict" }
    );
    expect(await getDeck(db, "alice", deck.id)).toBeNull();
    expect((await actOnDeck(db, "alice", deck.id, "restore")).outcome).toBe(
      "applied"
    );
    const back = await getDeck(db, "alice", deck.id);
    expect(back?.published).toBe(true);
    const entries = (await listRevisions(db, "alice", deck.id)).map(
      (r) => `${r.kind}:${r.author}`
    );
    expect(entries.slice(0, 3)).toEqual([
      "restore:member",
      "delete:agent",
      "publish:agent",
    ]);
  });

  it("refuses another member's deck for every action", async () => {
    const deck = await fresh();
    for (const action of [
      "publish",
      "unpublish",
      "delete",
      "restore",
    ] as const) {
      expect(await actOnDeck(db, "bob", deck.id, action)).toEqual({
        outcome: "gone",
      });
    }
  });
});
