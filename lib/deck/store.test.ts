import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, TEST_DATABASE_URL } from "../test-db";
import { DeckError } from "./errors";
import { sampleDocument } from "./sample";
import {
  type Actor,
  createDeck,
  deleteDeck,
  ensureUser,
  getDeck,
  getPublishedDeck,
  listDecks,
  mutateDeck,
  renameDeck,
  setPublished,
} from "./store";

const alice: Actor = { kind: "member", sub: "alice-sub" };
const bob: Actor = { kind: "member", sub: "bob-sub" };
const alicesAgent: Actor = { kind: "agent", sub: "alice-sub" };

async function refusal(promise: Promise<unknown>): Promise<DeckError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DeckError) return error;
    throw error;
  }
  throw new Error("expected a DeckError");
}

describe.skipIf(!TEST_DATABASE_URL)("deck store (Postgres)", () => {
  let db: postgres.Sql;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await ensureUser(db, { sub: alice.sub, name: "Alice" });
    await ensureUser(db, { sub: bob.sub, name: "Bob" });
  });

  afterAll(async () => {
    await drop?.();
  });

  it("creates a deck at version 0 and lists it for its owner only", async () => {
    const deck = await createDeck(db, alice.sub, sampleDocument());
    expect(deck.version).toBe(0);
    expect(deck.title).toBe("Agent Sense");
    expect(deck.id).toMatch(/^dk_/);
    expect((await listDecks(db, alice.sub)).map((d) => d.id)).toContain(
      deck.id
    );
    expect(await listDecks(db, bob.sub)).toEqual([]);
  });

  it("publishes a deck under a public id it keeps", async () => {
    const deck = await createDeck(db, alice.sub, sampleDocument());
    expect(await getPublishedDeck(db, "x".repeat(16))).toBeNull();
    // Unpublishing a deck never published makes no link.
    expect(await setPublished(db, alice.sub, deck.id, false)).toEqual({
      published: false,
      publicId: null,
    });
    expect(await setPublished(db, bob.sub, deck.id, true)).toBeNull();

    const first = await setPublished(db, alice.sub, deck.id, true);
    expect(first?.published).toBe(true);
    expect(first?.publicId).toMatch(/^[0-9a-z]{16}$/);
    expect((await getPublishedDeck(db, first!.publicId!))?.id).toBe(deck.id);

    const off = await setPublished(db, alice.sub, deck.id, false);
    expect(off).toEqual({ published: false, publicId: first!.publicId });
    expect(await getPublishedDeck(db, first!.publicId!)).toBeNull();

    // Publishing again brings the same link back.
    expect(await setPublished(db, alice.sub, deck.id, true)).toEqual(first);
    expect(await getPublishedDeck(db, "../" + first!.publicId)).toBeNull();
  });

  it("hides a deck from everyone but its owner", async () => {
    const deck = await createDeck(db, alice.sub);
    expect((await getDeck(db, alice.sub, deck.id))?.id).toBe(deck.id);
    expect(await getDeck(db, bob.sub, deck.id)).toBeNull();
    const denied = await refusal(
      mutateDeck(db, {
        deckId: deck.id,
        actor: bob,
        baseVersion: 0,
        ops: [{ op: "replace", path: "/title", value: "Mine now" }],
      })
    );
    expect(denied.code).toBe("not_found");
    expect((await getDeck(db, alice.sub, deck.id))?.title).toBe("未命名簡報");
  });

  it("applies a member's patch, bumps the version and records a revision", async () => {
    const deck = await createDeck(db, alice.sub, sampleDocument());
    const result = await mutateDeck(db, {
      deckId: deck.id,
      actor: alice,
      baseVersion: 0,
      ops: [
        { op: "replace", path: "/title", value: "Agent Sense v2" },
        { op: "replace", path: "/slides/0/shapes/0/fill", value: "#ffffff" },
      ],
    });
    expect(result).toMatchObject({ status: "applied", version: 1 });

    const after = await getDeck(db, alice.sub, deck.id);
    expect(after?.version).toBe(1);
    expect(after?.title).toBe("Agent Sense v2");
    expect(after?.document.title).toBe("Agent Sense v2");

    const [revision] = await db`
      select * from revisions where id = ${result.revisionId}
    `;
    expect(revision).toMatchObject({
      deck_id: deck.id,
      base_version: 0,
      version: 1,
      author_kind: "member",
      author_sub: alice.sub,
      status: "applied",
    });
    expect(revision.patch).toHaveLength(2);
    expect(revision.inverse.length).toBeGreaterThan(0);
  });

  it("rejects a patch written against an older version", async () => {
    const deck = await createDeck(db, alice.sub);
    const edit = (baseVersion: number, value: string) =>
      mutateDeck(db, {
        deckId: deck.id,
        actor: alice,
        baseVersion,
        ops: [{ op: "replace", path: "/title", value }],
      });
    await edit(0, "First");
    const stale = await refusal(edit(0, "Stale"));
    expect(stale.code).toBe("conflict");
    expect(stale.details.currentVersion).toBe(1);
    expect((await getDeck(db, alice.sub, deck.id))?.title).toBe("First");
  });

  it("lets exactly one of two concurrent writers on the same version win", async () => {
    const deck = await createDeck(db, alice.sub);
    const results = await Promise.allSettled(
      ["Left", "Right"].map((value) =>
        mutateDeck(db, {
          deckId: deck.id,
          actor: alice,
          baseVersion: 0,
          ops: [{ op: "replace", path: "/title", value }],
        })
      )
    );
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason.code).toBe("conflict");
    const [{ count }] = await db`
      select count(*)::int as count from revisions where deck_id = ${deck.id}
    `;
    expect(count).toBe(1);
  });

  it("stores an agent's patch as a suggestion and leaves the deck as it was", async () => {
    const deck = await createDeck(db, alice.sub, sampleDocument());
    const result = await mutateDeck(db, {
      deckId: deck.id,
      actor: alicesAgent,
      baseVersion: 0,
      ops: [{ op: "replace", path: "/slides/0/title", value: "Overview" }],
    });
    expect(result).toMatchObject({ status: "suggested", version: 0 });
    const after = await getDeck(db, alice.sub, deck.id);
    expect(after?.version).toBe(0);
    expect(after?.document.slides[0].title).toBe("System overview");
    const [revision] = await db`
      select status, author_kind, version, inverse from revisions
      where id = ${result.revisionId}
    `;
    expect(revision).toEqual({
      status: "suggested",
      author_kind: "agent",
      version: null,
      inverse: null,
    });
  });

  it("stores nothing when the patch or its result is invalid", async () => {
    const deck = await createDeck(db, alice.sub, sampleDocument());
    const badPath = await refusal(
      mutateDeck(db, {
        deckId: deck.id,
        actor: alice,
        baseVersion: 0,
        ops: [{ op: "remove", path: "/slides/3" }],
      })
    );
    expect(badPath.code).toBe("invalid_patch");
    const badResult = await refusal(
      mutateDeck(db, {
        deckId: deck.id,
        actor: alicesAgent,
        baseVersion: 0,
        ops: [{ op: "remove", path: "/slides/0/shapes/0" }],
      })
    );
    expect(badResult.code).toBe("invalid_document");
    expect(badResult.details.issues?.[0]).toMatch(/sh_capture is not a shape/);
    const badOp = await refusal(
      mutateDeck(db, {
        deckId: deck.id,
        actor: alice,
        baseVersion: 0,
        ops: [{ op: "toString", path: "/title", value: "x" }],
      })
    );
    expect(badOp.code).toBe("invalid_patch");
    const [{ count }] = await db`
      select count(*)::int as count from revisions where deck_id = ${deck.id}
    `;
    expect(count).toBe(0);
    expect((await getDeck(db, alice.sub, deck.id))?.version).toBe(0);
  });

  const revisionCount = async (deckId: string) => {
    const [{ count }] = await db`
      select count(*)::int as count from revisions where deck_id = ${deckId}
    `;
    return count as number;
  };

  it("lists each deck with its slide count and first slide", async () => {
    await ensureUser(db, { sub: "carol-sub", name: "Carol" });
    const deck = await createDeck(db, "carol-sub", sampleDocument());
    const [summary] = await listDecks(db, "carol-sub");
    expect(summary).toMatchObject({
      id: deck.id,
      title: "Agent Sense",
      slideCount: deck.document.slides.length,
      template: "winlab",
    });
    expect(summary.firstSlide).toEqual(deck.document.slides[0]);
  });

  it("starts a new deck on the plain template", async () => {
    await ensureUser(db, { sub: "dave-sub", name: "Dave" });
    const deck = await createDeck(db, "dave-sub");
    expect(deck.document.template).toBe("plain");
    const [summary] = await listDecks(db, "dave-sub");
    expect(summary.template).toBe("plain");
  });

  it("renames a deck as a revision, whatever version it is at", async () => {
    const deck = await createDeck(db, alice.sub);
    await mutateDeck(db, {
      deckId: deck.id,
      actor: alice,
      baseVersion: 0,
      ops: [{ op: "replace", path: "/slides/0/title", value: "Intro" }],
    });
    expect(await renameDeck(db, alice.sub, deck.id, "  Weekly  ")).toBe(true);
    const after = await getDeck(db, alice.sub, deck.id);
    expect(after).toMatchObject({ title: "Weekly", version: 2 });
    expect(after?.document.title).toBe("Weekly");
    const [revision] = await db`
      select patch, inverse from revisions
      where deck_id = ${deck.id} order by id desc limit 1
    `;
    expect(revision.patch).toEqual([
      { op: "replace", path: "/title", value: "Weekly" },
    ]);
    expect(revision.inverse).toContainEqual(
      expect.objectContaining({ path: "/title", value: "未命名簡報" })
    );
  });

  it("writes nothing when a deck is renamed to its own title", async () => {
    const deck = await createDeck(db, alice.sub);
    expect(await renameDeck(db, alice.sub, deck.id, "未命名簡報 ")).toBe(true);
    expect((await getDeck(db, alice.sub, deck.id))?.version).toBe(0);
    expect(await revisionCount(deck.id)).toBe(0);
  });

  it("lets two concurrent renames both land, one after the other", async () => {
    const deck = await createDeck(db, alice.sub);
    const results = await Promise.all(
      ["Left", "Right"].map((title) =>
        renameDeck(db, alice.sub, deck.id, title)
      )
    );
    expect(results).toEqual([true, true]);
    const after = await getDeck(db, alice.sub, deck.id);
    expect(after?.version).toBe(2);
    expect(["Left", "Right"]).toContain(after?.title);
  });

  it("neither renames nor deletes someone else's deck", async () => {
    const deck = await createDeck(db, alice.sub);
    expect(await renameDeck(db, bob.sub, deck.id, "Mine now")).toBe(false);
    expect(await deleteDeck(db, bob.sub, deck.id)).toBe(false);
    expect(await getDeck(db, alice.sub, deck.id)).toMatchObject({
      title: "未命名簡報",
      version: 0,
    });
  });

  it("deletes a deck with its revisions", async () => {
    const deck = await createDeck(db, alice.sub);
    await renameDeck(db, alice.sub, deck.id, "Doomed");
    expect(await revisionCount(deck.id)).toBe(1);
    expect(await deleteDeck(db, alice.sub, deck.id)).toBe(true);
    expect(await getDeck(db, alice.sub, deck.id)).toBeNull();
    expect(await revisionCount(deck.id)).toBe(0);
    expect(await deleteDeck(db, alice.sub, deck.id)).toBe(false);
    expect(await renameDeck(db, alice.sub, deck.id, "Back")).toBe(false);
  });
});
