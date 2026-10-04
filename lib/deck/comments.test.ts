import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, TEST_DATABASE_URL } from "../test-db";
import { addComment, addToThread, listThreads } from "./comments";
import { actOnDeck } from "./revisions";
import { sampleDocument } from "./sample";
import { createDeck, ensureUser, mutateDeck } from "./store";

describe.skipIf(!TEST_DATABASE_URL)("comments (Postgres)", () => {
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

  const fresh = () => createDeck(db, "alice", sampleDocument());
  const slideId = sampleDocument().slides[0].id;

  it("anchors a comment to a slide and the shapes and words selected", async () => {
    const deck = await fresh();
    const added = await addComment(db, "alice", deck.id, {
      slideId,
      targets: [
        { shape: "sh_asr", text: { from: { p: 0, o: 0 }, to: { p: 0, o: 4 } } },
        { shape: "sh_capture" },
      ],
      body: "Make these two the same size",
    });
    expect(added.outcome).toBe("added");
    const [thread] = await listThreads(db, "alice", deck.id);
    expect(thread).toMatchObject({
      author: "member",
      body: "Make these two the same size",
      slideId,
      status: "open",
      replies: [],
    });
    expect(thread.targets.map((t) => t.shape)).toEqual([
      "sh_asr",
      "sh_capture",
    ]);
    expect(await listThreads(db, "bob", deck.id)).toEqual([]);
  });

  it("refuses a slide or shape that is not there, and someone else's deck", async () => {
    const deck = await fresh();
    expect(
      await addComment(db, "alice", deck.id, {
        slideId: "sl_nothere",
        targets: [],
        body: "x",
      })
    ).toMatchObject({ outcome: "invalid" });
    expect(
      await addComment(db, "alice", deck.id, {
        slideId,
        targets: [{ shape: "sh_ghost" }],
        body: "x",
      })
    ).toMatchObject({ outcome: "invalid" });
    expect(
      await addComment(db, "bob", deck.id, { slideId, targets: [], body: "x" })
    ).toEqual({ outcome: "gone" });
  });

  it("keeps replies, resolving and reopening as a record", async () => {
    const deck = await fresh();
    const thread = await addComment(db, "alice", deck.id, {
      slideId,
      targets: [{ shape: "sh_asr" }],
      body: "Blue, please",
    });
    const id = (thread as { id: string }).id;

    // The agent answers with a suggestion and says so.
    const suggestion = await mutateDeck(db, {
      deckId: deck.id,
      actor: { kind: "agent", sub: "alice" },
      baseVersion: 0,
      ops: [{ op: "replace", path: "/title", value: "Blue" }],
    });
    expect(
      await addToThread(
        db,
        "alice",
        deck.id,
        id,
        {
          kind: "reply",
          body: "Done in a suggestion",
          entryId: suggestion.revisionId,
        },
        "agent"
      )
    ).toMatchObject({ outcome: "added" });
    expect(
      await addToThread(db, "alice", deck.id, id, { kind: "resolve" }, "agent")
    ).toMatchObject({ outcome: "added" });
    // Resolving twice changes nothing.
    expect(
      await addToThread(db, "alice", deck.id, id, { kind: "resolve" })
    ).toEqual({ outcome: "unchanged" });
    expect(await listThreads(db, "alice", deck.id, { status: "open" })).toEqual(
      []
    );
    expect(
      await addToThread(db, "alice", deck.id, id, { kind: "reopen" })
    ).toMatchObject({ outcome: "added" });

    const [after] = await listThreads(db, "alice", deck.id, { status: "open" });
    expect(after.replies.map((r) => `${r.kind}:${r.author}`)).toEqual([
      "reply:agent",
      "resolve:agent",
      "reopen:member",
    ]);
    expect(after.replies[0].entryId).toBe(suggestion.revisionId);
  });

  it("refuses an empty reply, an entry of another deck and a deleted deck", async () => {
    const deck = await fresh();
    const other = await fresh();
    const thread = await addComment(db, "alice", deck.id, {
      slideId,
      targets: [],
      body: "Whole slide",
    });
    const id = (thread as { id: string }).id;
    expect(
      await addToThread(db, "alice", deck.id, id, { kind: "reply", body: " " })
    ).toMatchObject({ outcome: "invalid" });
    const elsewhere = await actOnDeck(db, "alice", other.id, "publish");
    expect(
      await addToThread(db, "alice", deck.id, id, {
        kind: "reply",
        body: "See there",
        entryId: (elsewhere as { revisionId: string }).revisionId,
      })
    ).toMatchObject({ outcome: "invalid" });
    expect(
      await addToThread(db, "alice", other.id, id, { kind: "resolve" })
    ).toEqual({ outcome: "gone" });
    await actOnDeck(db, "alice", deck.id, "delete");
    expect(
      await addToThread(db, "alice", deck.id, id, { kind: "resolve" })
    ).toEqual({ outcome: "gone" });
    expect(await listThreads(db, "alice", deck.id)).toEqual([]);
  });
});
