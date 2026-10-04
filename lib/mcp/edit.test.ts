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

  it("plans again on the member's version when they saved in between", async () => {
    const deck = await createDeck(db, "alice", sampleDocument());
    let raced = 0;
    const racing: typeof mutateDeck = async (database, input) => {
      if (raced === 0) {
        raced += 1;
        // The member's save lands between the agent's read and its write.
        await mutateDeck(database, {
          deckId: input.deckId,
          actor: { kind: "member", sub: "alice" },
          baseVersion: input.baseVersion,
          ops: [{ op: "replace", path: "/slides/0/title", value: "Raced" }],
        });
      }
      return mutateDeck(database, input);
    };
    const outcome = await editDeck(
      db,
      "alice",
      deck.id,
      fill("#e2f0d9"),
      racing
    );
    expect(outcome).toMatchObject({
      ok: true,
      version: 2,
      changed: ["sh_asr"],
    });
    const after = (await getDeck(db, "alice", deck.id))!;
    expect(after.document.slides[0].title).toBe("Raced");
    expect(
      after.document.slides[0].shapes.find((shape) => shape.id === "sh_asr")
    ).toMatchObject({ fill: "#e2f0d9" });
  });

  it("gives up after a few conflicts, and says why a plan cannot be made", async () => {
    const deck = await createDeck(db, "alice", sampleDocument());
    const busy: typeof mutateDeck = async (database, input) => {
      await mutateDeck(database, {
        deckId: input.deckId,
        actor: { kind: "member", sub: "alice" },
        baseVersion: input.baseVersion,
        ops: [
          { op: "replace", path: "/title", value: `v${input.baseVersion}` },
        ],
      });
      return mutateDeck(database, input);
    };
    const outcome = await editDeck(db, "alice", deck.id, fill("#fbe5d6"), busy);
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { message: string }).message).toMatch(/version/);

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
