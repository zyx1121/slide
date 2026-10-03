import { NextResponse, type NextRequest } from "next/server";

import { authEnv } from "@/lib/auth/config";
import { readSession } from "@/lib/auth/session";

// Sends signed-out visitors to sign-in. Pages and Server Functions still check
// the session themselves (requireUser); this is the first gate, not the only one.
export async function proxy(request: NextRequest) {
  // A Server Action redirects a signed-out member itself (requireUser). A 307
  // from here would make the browser repeat the POST at /auth/login. Actions
  // are POSTs only, so a GET with the header still meets this gate.
  if (request.method === "POST" && request.headers.has("next-action")) {
    return NextResponse.next();
  }
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
  // Everything except sign-in itself, the health check, uploads (which
  // check the session themselves, and whose bodies a proxy would buffer and
  // cut at its own limit), public decks (/s/), the template background
  // public decks draw on, and static files.
  matcher: [
    "/((?!auth/|api/health$|api/assets$|api/decks/import$|s/|template/|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
