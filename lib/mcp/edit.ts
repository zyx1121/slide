// Server only: an agent's edit, planned on the deck as it is while its row is
// held (mutateDeck), so a save the member made a moment before is already in
// the document it is planned on, and the two never conflict.
import type postgres from "postgres";

import { DeckError } from "../deck/errors";
import type { DeckDocument } from "../deck/schema";
import { mutateDeck } from "../deck/store";
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

export async function editDeck(
  db: postgres.Sql,
  sub: string,
  deckId: string,
  plan: (document: DeckDocument) => Planned
): Promise<EditOutcome> {
  const made: { planned?: Planned } = {};
  try {
    const result = await mutateDeck(db, {
      deckId,
      actor: { kind: "agent", sub },
      plan: (document) => {
        made.planned = plan(document);
        return made.planned.ops;
      },
    });
    return {
      ok: true,
      entry: result.revisionId,
      version: result.version,
      created: made.planned!.created,
      changed: made.planned!.changed,
    };
  } catch (error) {
    if (error instanceof WriteError)
      return { ok: false, message: error.message };
    if (!(error instanceof DeckError)) throw error;
    if (error.code === "not_found") {
      return {
        ok: false,
        message: `No deck ${deckId} among the member's decks.`,
      };
    }
    const issues = error.details.issues;
    return {
      ok: false,
      message: issues?.length
        ? `${error.message}:\n${issues.join("\n")}`
        : error.message,
    };
  }
}
