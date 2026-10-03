import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type postgres from "postgres";

import { misnamedMigrations, pendingMigrations } from "./migrations";

/**
 * Applies `dir`/NNNN_name.sql files in name order, each in its own
 * transaction, and records them in schema_migrations. An advisory lock on a
 * reserved connection keeps two runs from interleaving. A missing directory
 * or a misnamed .sql file is an error, not "nothing to apply".
 */
export async function migrate(
  sql: postgres.Sql,
  dir: string,
  log: (line: string) => void = console.log
): Promise<{ applied: string[]; total: number }> {
  const files = await readdir(dir);
  const misnamed = misnamedMigrations(files);
  if (misnamed.length > 0) {
    throw new Error(
      `${dir}: ${misnamed.join(", ")} must be named NNNN_name.sql to be applied`
    );
  }

  const conn = await sql.reserve();
  try {
    await conn`select pg_advisory_lock(hashtext('slide.migrate'))`;
    try {
      await conn`
        create table if not exists schema_migrations (
          name text primary key,
          applied_at timestamptz not null default now()
        )
      `;
      const rows = await conn<
        { name: string }[]
      >`select name from schema_migrations`;
      const done = rows.map((row) => row.name);
      const pending = pendingMigrations(files, done);

      for (const name of pending) {
        const body = await readFile(join(dir, name), "utf8");
        try {
          await conn.unsafe("begin");
          await conn.unsafe(body);
          await conn`insert into schema_migrations (name) values (${name})`;
          await conn.unsafe("commit");
        } catch (error) {
          await conn.unsafe("rollback").catch(() => {});
          throw new Error(`${name} failed and was rolled back`, {
            cause: error,
          });
        }
        log(`migrate: applied ${name}`);
      }
      const total = done.length + pending.length;
      log(`migrate: ${pending.length} applied, ${total} total`);
      return { applied: pending, total };
    } finally {
      await conn`select pg_advisory_unlock(hashtext('slide.migrate'))`;
    }
  } finally {
    conn.release();
  }
}
