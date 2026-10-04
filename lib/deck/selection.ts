// What the member has selected in the editor, kept so their agent can read
// it over MCP (get_selection): a deck, a slide, and the shapes on it, each
// with a text range when part of its text is selected. One row a member;
// the editor writes it as the selection changes.
import type postgres from "postgres";
import * as z from "zod";

type Db = postgres.Sql;

const Pos = z.strictObject({
  p: z.number().int().min(0).max(500),
  o: z.number().int().min(0).max(20_000),
});

export const Target = z.strictObject({
  shape: z.string().regex(/^[a-z]+_[0-9a-z_-]{2,48}$/),
  /** Part of the shape's text: from and to positions, paragraph and offset. */
  text: z.strictObject({ from: Pos, to: Pos }).optional(),
});
export type Target = z.infer<typeof Target>;

export const SelectionInput = z.strictObject({
  slideId: z.string().regex(/^[a-z]+_[0-9a-z_-]{2,48}$/),
  targets: z.array(Target).max(1000),
});

export type Selection = {
  deckId: string;
  slideId: string;
  targets: Target[];
  updatedAt: Date;
};

/** Stores the member's selection on one of their decks; false when the deck is not theirs. */
export async function saveSelection(
  db: Db,
  sub: string,
  deckId: string,
  input: z.infer<typeof SelectionInput>
): Promise<boolean> {
  const rows = await db`
    insert into selections (user_sub, deck_id, slide_id, targets, updated_at)
    select ${sub}, d.id, ${input.slideId}, ${db.json(input.targets as postgres.JSONValue)}, now()
    from decks d
    where d.id = ${deckId} and d.owner_sub = ${sub} and d.deleted_at is null
    on conflict (user_sub) do update
      set deck_id = excluded.deck_id, slide_id = excluded.slide_id,
          targets = excluded.targets, updated_at = now()
    returning user_sub`;
  return rows.length > 0;
}

/** The member's latest selection, or null. */
export async function getSelection(
  db: Db,
  sub: string
): Promise<Selection | null> {
  const [row] = await db<
    {
      deck_id: string | null;
      slide_id: string | null;
      targets: Target[];
      updated_at: Date;
    }[]
  >`
    select s.deck_id, s.slide_id, s.targets, s.updated_at from selections s
    join decks d on d.id = s.deck_id and d.owner_sub = ${sub}
      and d.deleted_at is null
    where s.user_sub = ${sub}`;
  if (!row?.deck_id || !row.slide_id) return null;
  return {
    deckId: row.deck_id,
    slideId: row.slide_id,
    targets: row.targets,
    updatedAt: row.updated_at,
  };
}
