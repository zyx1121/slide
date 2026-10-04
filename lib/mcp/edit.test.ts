import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import { createDeck, ensureUser, getDeck, mutateDeck } from "../deck/store";
import { createTestDb, TEST_DATABASE_URL } from "../test-db";
import { editDeck } from "./edit";
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

  it("says why a plan cannot be made, or the deck is not there", async () => {
    const deck = await createDeck(db, "alice", sampleDocument());
    const missing = await editDeck(db, "alice", deck.id, (document) =>
      updateShapes(document, 1, [
        { id: "sh_nothere", set: { fill: "#000000" } },
      ])
    );
    expect(missing).toMatchObject({ ok: false });
    expect(
      await editDeck(db, "alice", "dk_nothere00", fill("#000000"))
    ).toEqual({
      ok: false,
      message: "No deck dk_nothere00 among the member's decks.",
    });
  });
});
