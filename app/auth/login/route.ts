import type { NextRequest } from "next/server";

import { authEnv } from "@/lib/auth/config";
import { startSignIn } from "@/lib/auth/flow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return startSignIn(request, authEnv());
}
