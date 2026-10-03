import { NextResponse, type NextRequest } from "next/server";

import { authEnv } from "@/lib/auth/config";
import { readSession } from "@/lib/auth/session";

// Sends signed-out visitors to sign-in. Pages and Server Functions still check
// the session themselves (requireUser); this is the first gate, not the only one.
export async function proxy(request: NextRequest) {
  const env = authEnv();
  if (await readSession(request, env)) return NextResponse.next();
  const login = new URL("/auth/login", env.appUrl);
  login.searchParams.set(
    "next",
    request.nextUrl.pathname + request.nextUrl.search
  );
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except sign-in itself, the health check, public decks (/s/),
  // and static files.
  matcher: [
    "/((?!auth/|api/health|s/|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
