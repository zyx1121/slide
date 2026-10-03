// Tests that need Postgres run against TEST_DATABASE_URL, each in a fresh
// schema of its own that is dropped afterwards. Without the variable they
// are skipped (CI sets it; see .github/workflows/ci.yml).
import { join } from "node:path";

import postgres from "postgres";

import { newId } from "./ids";
import { migrate } from "./migrate";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export async function createTestDb(): Promise<{
  db: postgres.Sql;
  drop: () => Promise<void>;
}> {
  const url = TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const schema = newId("test", 10);

  const admin = postgres(url, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create schema ${schema}`);
  await admin.end();

  const db = postgres(url, {
    max: 4,
    onnotice: () => {},
    connection: { search_path: schema },
  });
  await migrate(db, join(process.cwd(), "migrations"), () => {});

  return {
    db,
    async drop() {
      await db.unsafe(`drop schema ${schema} cascade`);
      await db.end();
    },
  };
}
