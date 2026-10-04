import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { updateShapes } from "../mcp/write";
import { createTestDb, TEST_DATABASE_URL } from "../test-db";
import {
  acceptSuggestion,
  actOnDeck,
  listRevisions,
  listSuggestions,
  rejectSuggestion,
  revertRevision,
} from "./revisions";
import { sampleDocument } from "./sample";
import { createDeck, ensureUser, getDeck, mutateDeck } from "./store";

describe.skipIf(!TEST_DATABASE_URL)(
  "suggestions and history (Postgres)",
  () => {
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
    async function suggest(deckId: string, set: Record<string, unknown>) {
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

    it("accepts a suggestion as the agent's applied revision", async () => {
      const deck = await fresh();
      const id = await suggest(deck.id, { fill: "#fff2cc" });
      const [pending] = await listSuggestions(db, "alice", deck.id);
      expect(pending).toMatchObject({
        id,
        author: "agent",
        stale: false,
        changes: 1,
      });
      expect(await listSuggestions(db, "bob", deck.id)).toEqual([]);

      expect(await acceptSuggestion(db, "alice", deck.id, id)).toEqual({
        outcome: "applied",
        version: 1,
        kind: "edit",
      });
      expect((await asr(deck.id)).fill).toBe("#fff2cc");
      const [latest] = await listRevisions(db, "alice", deck.id);
      expect(latest).toMatchObject({
        id,
        status: "applied",
        author: "agent",
        version: 1,
      });
      // Another member cannot accept it again, or at all.
      expect(await acceptSuggestion(db, "bob", deck.id, id)).toEqual({
        outcome: "gone",
      });
    });

    it("rejects a suggestion and leaves the deck alone", async () => {
      const deck = await fresh();
      const id = await suggest(deck.id, { fill: "#c00000" });
      expect(await rejectSuggestion(db, "bob", deck.id, id)).toBe(false);
      expect(await rejectSuggestion(db, "alice", deck.id, id)).toBe(true);
      expect(await listSuggestions(db, "alice", deck.id)).toEqual([]);
      expect((await asr(deck.id)).fill).not.toBe("#c00000");
    });

    it("flags a stale suggestion and treats one already done as done", async () => {
      const deck = await fresh();
      const id = await suggest(deck.id, { fill: "#70ad47" });
      await edit(deck.id, { fill: "#70ad47" });
      const [pending] = await listSuggestions(db, "alice", deck.id);
      expect(pending.stale).toBe(true);
      expect(await acceptSuggestion(db, "alice", deck.id, id)).toEqual({
        outcome: "already",
      });
      expect(await listSuggestions(db, "alice", deck.id)).toEqual([]);
    });

    it("refuses a suggestion whose shapes moved", async () => {
      const deck = await fresh();
      const id = await suggest(deck.id, { x: 10 });
      const current = (await getDeck(db, "alice", deck.id))!;
      await mutateDeck(db, {
        deckId: deck.id,
        actor: { kind: "member", sub: "alice" },
        baseVersion: current.version,
        ops: [
          {
            op: "move",
            from: "/slides/0/shapes/1",
            path: "/slides/0/shapes/0",
          },
        ],
      });
      const result = await acceptSuggestion(db, "alice", deck.id, id);
      expect(result.outcome).toBe("conflict");
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

    it("asks before an agent publishes or deletes, and lets anyone decide", async () => {
      const deck = await fresh();
      const ask = await actOnDeck(db, "alice", deck.id, "publish", "agent");
      expect(ask.outcome).toBe("requested");
      expect((await getDeck(db, "alice", deck.id))!.published).toBe(false);
      const [pending] = await listSuggestions(db, "alice", deck.id);
      expect(pending).toMatchObject({
        kind: "publish",
        author: "agent",
        stale: false,
        decidedBy: null,
      });

      // The member tells the agent to go ahead: the agent accepts.
      const id = (ask as { revisionId: string }).revisionId;
      expect(
        await acceptSuggestion(db, "alice", deck.id, id, "agent")
      ).toMatchObject({ outcome: "applied", kind: "publish" });
      expect((await getDeck(db, "alice", deck.id))!.published).toBe(true);
      const [entry] = await listRevisions(db, "alice", deck.id);
      expect(entry).toMatchObject({
        id,
        kind: "publish",
        status: "applied",
        author: "agent",
        decidedBy: "agent",
      });

      // Unpublishing is not risky: an agent's applies at once.
      expect(
        (await actOnDeck(db, "alice", deck.id, "unpublish", "agent")).outcome
      ).toBe("applied");
      expect((await getDeck(db, "alice", deck.id))!.published).toBe(false);

      // A delete request rejected leaves the deck; accepted, deletes it.
      const doomed = await actOnDeck(db, "alice", deck.id, "delete", "agent");
      const doomedId = (doomed as { revisionId: string }).revisionId;
      expect(await rejectSuggestion(db, "alice", deck.id, doomedId)).toBe(true);
      expect(await getDeck(db, "alice", deck.id)).not.toBeNull();
      const again = await actOnDeck(db, "alice", deck.id, "delete", "agent");
      const againId = (again as { revisionId: string }).revisionId;
      expect(
        await acceptSuggestion(db, "alice", deck.id, againId)
      ).toMatchObject({ outcome: "applied", kind: "delete" });
      expect(await getDeck(db, "alice", deck.id)).toBeNull();

      // Reverting the delete restores the deck, as a new entry.
      expect(await revertRevision(db, "alice", deck.id, againId)).toMatchObject(
        { outcome: "applied", kind: "restore" }
      );
      expect(await getDeck(db, "alice", deck.id)).not.toBeNull();
      const kinds = (await listRevisions(db, "alice", deck.id)).map(
        (r) => `${r.kind}:${r.status}`
      );
      expect(kinds.slice(0, 5)).toEqual([
        "restore:applied",
        "delete:applied",
        "delete:rejected",
        "unpublish:applied",
        "publish:applied",
      ]);
    });

    it("turns an agent's revert of an unpublish into a publish request", async () => {
      const deck = await fresh();
      await actOnDeck(db, "alice", deck.id, "publish");
      const off = await actOnDeck(db, "alice", deck.id, "unpublish");
      const offId = (off as { revisionId: string }).revisionId;
      expect(
        await revertRevision(db, "alice", deck.id, offId, "agent")
      ).toMatchObject({ outcome: "requested" });
      expect((await getDeck(db, "alice", deck.id))!.published).toBe(false);
      // An agent's revert of an edit applies at once and names the agent.
      const edited = await edit(deck.id, { x: 5 });
      expect(
        await revertRevision(db, "alice", deck.id, edited.revisionId, "agent")
      ).toMatchObject({ outcome: "applied", kind: "edit" });
      const [latest] = await listRevisions(db, "alice", deck.id);
      expect(latest).toMatchObject({ author: "agent", decidedBy: "agent" });
    });

    it("asks before an agent restores a deck that was public", async () => {
      const deck = await fresh();
      await actOnDeck(db, "alice", deck.id, "publish");
      await actOnDeck(db, "alice", deck.id, "delete");
      expect(
        (await actOnDeck(db, "alice", deck.id, "restore", "agent")).outcome
      ).toBe("requested");
      expect(await getDeck(db, "alice", deck.id)).toBeNull();
      // A private deck comes back at once.
      const quiet = await fresh();
      await actOnDeck(db, "alice", quiet.id, "delete");
      expect(
        (await actOnDeck(db, "alice", quiet.id, "restore", "agent")).outcome
      ).toBe("applied");
    });

    it("reverts a deck action only while no later one followed", async () => {
      const deck = await fresh();
      const first = await actOnDeck(db, "alice", deck.id, "publish");
      await actOnDeck(db, "alice", deck.id, "unpublish");
      await actOnDeck(db, "alice", deck.id, "publish");
      const firstId = (first as { revisionId: string }).revisionId;
      expect(await revertRevision(db, "alice", deck.id, firstId)).toMatchObject(
        { outcome: "conflict" }
      );
      expect((await getDeck(db, "alice", deck.id))!.published).toBe(true);
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
  }
);
