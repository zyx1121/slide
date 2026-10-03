// Applies migrations/*.sql in name order, each in its own transaction, and
// records every applied file in schema_migrations. An advisory lock keeps two
// runs from interleaving. The Docker image runs a bundled copy of this file
// (`bun run build:migrate`) as the `migrate` role.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import postgres from "postgres";

import { misnamedMigrations, pendingMigrations } from "../lib/migrations";

const dir = process.env.MIGRATIONS_DIR || join(process.cwd(), "migrations");
const sql = postgres(process.env.DATABASE_URL!, {
  max: 1,
  onnotice: () => {},
});

async function main() {
  // A missing or unreadable directory is an error, not "nothing to apply".
  const files = await readdir(dir);
  const misnamed = misnamedMigrations(files);
  if (misnamed.length > 0) {
    throw new Error(
      `${dir}: ${misnamed.join(", ")} must be named NNNN_name.sql to be applied`
    );
  }

  await sql`select pg_advisory_lock(hashtext('slide.migrate'))`;
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const rows = await sql<
    { name: string }[]
  >`select name from schema_migrations`;
  const applied = rows.map((row) => row.name);
  const pending = pendingMigrations(files, applied);

  for (const name of pending) {
    const body = await readFile(join(dir, name), "utf8");
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${name})`;
      });
    } catch (error) {
      throw new Error(`${name} failed and was rolled back`, { cause: error });
    }
    console.log(`migrate: applied ${name}`);
  }
  console.log(
    `migrate: ${pending.length} applied, ${applied.length + pending.length} total`
  );
}

main()
  .then(() => sql.end())
  .catch(async (error: unknown) => {
    console.error("migrate:", error);
    await sql.end();
    process.exit(1);
  });
