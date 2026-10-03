// Reading uploads safely: bodies with a size limit, and only from this
// site's own pages.

/** The body, or null once it grows past `limit` bytes. */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/**
 * Whether a request comes from this site's own pages: the browser says so
 * (Sec-Fetch-Site), and the Origin it sends names the host the request was
 * made to, as Next.js checks Server Actions. The proxy in front passes the
 * original Host, or names it in X-Forwarded-Host.
 */
export function sameSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const host =
      request.headers.get("host") ??
      request.headers.get("x-forwarded-host") ??
      new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
