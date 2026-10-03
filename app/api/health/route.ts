import { authEnv } from "@/lib/auth/config";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DB_TIMEOUT_MS = 2000;

/** Liveness for the compose healthcheck and the smoke test: the app is up and reaches Postgres. */
export async function GET() {
  // Without its sign-in settings every page answers 500, so the app is not
  // healthy even when Postgres is.
  try {
    authEnv();
  } catch {
    return Response.json(
      { status: "error", config: "sign-in settings are missing" },
      { status: 503 }
    );
  }
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
