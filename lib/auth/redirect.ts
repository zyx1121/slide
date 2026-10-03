/**
 * A same-site path to return to after sign-in. Anything that could leave the
 * site (`//host`, `/\host`, `https://host`, control characters), or is too
 * long to carry, falls back to "/".
 */
const MAX_NEXT = 1024;

export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  // The path rides in the sign-in cookie, which must stay under 4 KB.
  if (next.length > MAX_NEXT) return "/";
  if (next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return "/";
  return next;
}
