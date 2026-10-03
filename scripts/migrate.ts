// The `migrate` role: applies migrations/*.sql (lib/migrate.ts) and exits.
// The Docker image runs a bundled copy of this file (`bun run build:migrate`).
import { join } from "node:path";

import postgres from "postgres";

import { migrate } from "../lib/migrate";

const dir = process.env.MIGRATIONS_DIR || join(process.cwd(), "migrations");
const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });

migrate(sql, dir)
  .then(() => sql.end())
  .catch(async (error: unknown) => {
    console.error("migrate:", error);
    await sql.end();
    process.exit(1);
  });
