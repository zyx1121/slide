import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import { createDeck, ensureUser, getDeck, mutateDeck } from "../deck/store";
import { createTestDb, TEST_DATABASE_URL } from "../test-db";
import type { DeckDocument } from "../deck/schema";
import { editDeck, type EditOutcome } from "./edit";
import { updateShapes } from "./write";

describe.skipIf(!TEST_DATABASE_URL)("editDeck (Postgres)", () => {
  let db: postgres.Sql;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await ensureUser(db, { sub: "alice" });
  });
  afterAll(async () => {
    await drop?.();
  });

  const fill =
    (color: string) => (document: Parameters<typeof updateShapes>[0]) =>
      updateShapes(document, 1, [{ id: "sh_asr", set: { fill: color } }]);

  it("plans on the deck as it is, so agents' edits never conflict", async () => {
    const deck = await createDeck(db, "alice", sampleDocument());
    // The member saved a moment before; two edits arrive at once.
    await mutateDeck(db, {
      deckId: deck.id,
      actor: { kind: "member", sub: "alice" },
      baseVersion: 0,
      ops: [{ op: "replace", path: "/slides/0/title", value: "Member's" }],
    });
    const outcomes = await Promise.all([
      editDeck(db, "alice", deck.id, fill("#e2f0d9")),
      editDeck(db, "alice", deck.id, (document) =>
        updateShapes(document, 1, [{ id: "sh_router", set: { x: 100 } }])
      ),
    ]);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, true]);
    const after = (await getDeck(db, "alice", deck.id))!;
    expect(after.version).toBe(3);
    expect(after.document.slides[0].title).toBe("Member's");
    const shapes = new Map(
      after.document.slides[0].shapes.map((shape) => [shape.id, shape])
    );
    expect(shapes.get("sh_asr")).toMatchObject({ fill: "#e2f0d9" });
    expect(shapes.get("sh_router")).toMatchObject({ x: 100 });
  });

  it("waits for a write holding the deck, then plans on what it left", async () => {
    const deck = await createDeck(db, "alice", sampleDocument());
    let pending: Promise<EditOutcome> | undefined;
    await db.begin(async (tx) => {
      // Another write holds the deck and puts a shape in front, so every
      // shape after it moves down one position.
      const [row] = await tx<{ document: DeckDocument }[]>`
        select document from decks where id = ${deck.id} for update`;
      const document = row.document;
      document.slides[0].shapes.unshift({
        ...document.slides[0].shapes[0],
        id: "sh_member",
      });
      // The agent's edit arrives now, and waits for the lock.
      pending = editDeck(db, "alice", deck.id, fill("#e2f0d9"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tx`
        update decks set document = ${tx.json(document as never)},
          version = version + 1
        where id = ${deck.id}`;
    });
    expect(await pending).toMatchObject({ ok: true, version: 2 });
    const shapes = (await getDeck(db, "alice", deck.id))!.document.slides[0]
      .shapes;
    expect(shapes.slice(0, 3).map((shape) => shape.id)).toEqual([
      "sh_member",
      "sh_capture",
      "sh_asr",
    ]);
    expect(shapes[2]).toMatchObject({ fill: "#e2f0d9" });
    expect(shapes[0]).not.toMatchObject({ fill: "#e2f0d9" });
  });

  it("says why a plan cannot be made, or the deck is not there", async () => {
    const deck = await createDeck(db, "alice", sampleDocument());
    const missing = await editDeck(db, "alice", deck.id, (document) =>
      updateShapes(document, 1, [
        { id: "sh_nothere", set: { fill: "#000000" } },
      ])
    );
    expect(missing).toMatchObject({ ok: false });
    expect((missing as { message: string }).message).toMatch(/sh_nothere/);
    expect(
      await editDeck(db, "alice", "dk_nothere00", fill("#000000"))
    ).toEqual({
      ok: false,
      message: "No deck dk_nothere00 among the member's decks.",
    });
  });
});
