import type { NextRequest } from "next/server";

import { authEnv } from "@/lib/auth/config";
import { finishSignIn } from "@/lib/auth/flow";
import { sql } from "@/lib/db";
import { ensureUser } from "@/lib/deck/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return finishSignIn(request, authEnv(), (user) => ensureUser(sql, user));
}
