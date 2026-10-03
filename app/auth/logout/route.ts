import type { NextRequest } from "next/server";

import { authEnv } from "@/lib/auth/config";
import { signOut } from "@/lib/auth/flow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST only: a GET would let any page sign a member out with an <img>.
export function POST(request: NextRequest) {
  return signOut(request, authEnv());
}
