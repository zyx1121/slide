import postgres from "postgres";

// One pool per server process. The dev server re-evaluates modules on reload,
// so the pool is kept on globalThis outside production.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export const sql =
  globalForDb.sql ?? postgres(process.env.DATABASE_URL!, { max: 10 });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;
