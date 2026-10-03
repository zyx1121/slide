import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DB_TIMEOUT_MS = 2000;

/** Liveness for the compose healthcheck and the smoke test: the app is up and reaches Postgres. */
export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A Postgres that accepts the connection but never answers would hang the
    // request, so the check gives up after DB_TIMEOUT_MS.
    await Promise.race([
      sql`select 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
      }),
    ]);
    return Response.json({ status: "ok", db: "ok" });
  } catch {
    return Response.json(
      { status: "error", db: "unreachable" },
      { status: 503 }
    );
  } finally {
    clearTimeout(timer);
  }
}
