/**
 * A same-site path to return to after sign-in. Anything that could leave the
 * site (`//host`, `/\host`, `https://host`, control characters) falls back
 * to "/".
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return "/";
  return next;
}
