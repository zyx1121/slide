// Server only: master files (lib/pptx/master-file.ts) kept by sha256. The
// built-in ones ship in template/; an imported deck's is stored here, and
// every member who imports the same file owns it, as with pictures.
import type postgres from "postgres";

import { Master } from "../deck/schema";
import { builtinMasterFile } from "./builtin-assets";
import { BUILTIN_IDS, BUILTIN_MASTERS, type BuiltinId } from "./layout";

type Db = postgres.Sql | postgres.TransactionSql;

/** The largest master file kept: masters with their pictures, no slides. */
export const MASTER_FILE_MAX_BYTES = 30 * 1024 * 1024;

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Stores a master file the member brought, once by its sha256, with the
 * master as the import read it.
 */
export async function saveMaster(
  db: Db,
  sub: string,
  file: { sha256: string; bytes: Uint8Array },
  master: Master
): Promise<void> {
  if (builtinMasterFile(file.sha256)) return;
  await db`
    insert into masters (sha256, bytes, master)
    values (${file.sha256}, ${Buffer.from(file.bytes)}, ${db.json(master as never)})
    on conflict (sha256) do nothing`;
  await db`
    insert into master_owners (sha256, sub)
    values (${file.sha256}, ${sub})
    on conflict do nothing`;
}

/**
 * A master file's bytes, for exporting a deck drawn on it. Whoever may read
 * the deck may export it, so this checks no owner: callers have already
 * checked the deck.
 */
export async function readMasterFile(
  db: Db,
  sha256: string
): Promise<Uint8Array | null> {
  if (!SHA256.test(sha256)) return null;
  const builtin = builtinMasterFile(sha256);
  if (builtin) return builtin;
  const [row] = await db<{ bytes: Buffer }[]>`
    select bytes from masters where sha256 = ${sha256}`;
  return row ? new Uint8Array(row.bytes) : null;
}

/** Whether the member may put a deck on the master file: built in, or theirs. */
export async function ownsMaster(
  db: Db,
  sub: string,
  sha256: string
): Promise<boolean> {
  if (!SHA256.test(sha256)) return false;
  if (builtinMasterFile(sha256)) return true;
  const [row] = await db`
    select 1 from master_owners where sha256 = ${sha256} and sub = ${sub}`;
  return !!row;
}

/** A master the member may put a deck on: a built-in by id, or theirs by sha256. */
export async function findMaster(
  db: Db,
  sub: string,
  ref: string
): Promise<Master | null> {
  if ((BUILTIN_IDS as readonly string[]).includes(ref)) {
    return BUILTIN_MASTERS[ref as BuiltinId];
  }
  if (!SHA256.test(ref)) return null;
  const [row] = await db<{ master: Master }[]>`
    select m.master from masters m
    join master_owners o on o.sha256 = m.sha256
    where m.sha256 = ${ref} and o.sub = ${sub}`;
  // Checked again, as everything that goes into a document is.
  return row && Master.safeParse(row.master).success ? row.master : null;
}

export type MasterSummary = {
  /** What set_master takes: a built-in's id, or a master file's sha256. */
  ref: string;
  name: string;
  layouts: string[];
};

/** The masters the member may put a deck on: the built-ins, then theirs. */
export async function listMasters(
  db: Db,
  sub: string
): Promise<MasterSummary[]> {
  const rows = await db<{ sha256: string; master: Master }[]>`
    select m.sha256, m.master from masters m
    join master_owners o on o.sha256 = m.sha256
    where o.sub = ${sub}
    order by o.created_at desc`;
  return [
    ...BUILTIN_IDS.map((id) => ({ ref: id, master: BUILTIN_MASTERS[id] })),
    ...rows.map((row) => ({ ref: row.sha256, master: row.master })),
  ].map(({ ref, master }) => ({
    ref,
    name: master.name,
    layouts: master.layouts.map((layout) => layout.name),
  }));
}
