// Server only: an agent's edit, planned on the deck as it is and applied at
// once. When the member saved in between, it is planned again on their
// version (it addresses shapes by id, so it means the same), a few times at
// most.
import type postgres from "postgres";

import { DeckError } from "../deck/errors";
import type { DeckDocument } from "../deck/schema";
import { getDeck, mutateDeck } from "../deck/store";
import { type Planned, WriteError } from "./write";

export type EditOutcome =
  | {
      ok: true;
      entry: string;
      version: number;
      created: string[];
      changed: string[];
    }
  | { ok: false; message: string };

const ATTEMPTS = 4;

export async function editDeck(
  db: postgres.Sql,
  sub: string,
  deckId: string,
  plan: (document: DeckDocument) => Planned,
  mutate: typeof mutateDeck = mutateDeck
): Promise<EditOutcome> {
  for (let attempt = 1; ; attempt++) {
    const deck = await getDeck(db, sub, deckId);
    if (!deck) {
      return {
        ok: false,
        message: `No deck ${deckId} among the member's decks.`,
      };
    }
    let planned: Planned;
    try {
      planned = plan(deck.document);
    } catch (error) {
      if (error instanceof WriteError)
        return { ok: false, message: error.message };
      throw error;
    }
    try {
      const result = await mutate(db, {
        deckId: deck.id,
        actor: { kind: "agent", sub },
        baseVersion: deck.version,
        ops: planned.ops,
      });
      return {
        ok: true,
        entry: result.revisionId,
        version: result.version,
        created: planned.created,
        changed: planned.changed,
      };
    } catch (error) {
      if (!(error instanceof DeckError)) throw error;
      if (error.code === "conflict" && attempt < ATTEMPTS) continue;
      const issues = (error.details as { issues?: string[] }).issues;
      return {
        ok: false,
        message: issues?.length
          ? `${error.message}:\n${issues.join("\n")}`
          : error.message,
      };
    }
  }
}
