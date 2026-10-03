import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Liveness for the compose healthcheck and the smoke test: the app is up and reaches Postgres. */
export async function GET() {
  try {
    await sql`select 1`;
    return Response.json({ status: "ok", db: "ok" });
  } catch {
    return Response.json(
      { status: "error", db: "unreachable" },
      { status: 503 }
    );
  }
}
