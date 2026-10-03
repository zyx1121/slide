import { getSession } from "@/lib/auth/session";
import { AssetError, saveAsset } from "@/lib/assets/store";
import { sql } from "@/lib/db";
import { ASSET_MAX_BYTES } from "@/lib/deck/limits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS = { empty: 400, "too-large": 413, unsupported: 415 } as const;

/** The body, or null once it grows past `limit` bytes. */
async function readCapped(
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
function sameSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const host =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * POST /api/assets: stores the request body, an image, for the member and
 * answers its sha256 and size. Only from this site: a cross-site page
 * cannot upload as the member.
 */
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return Response.json({ error: "sign in first" }, { status: 401 });
  if (!sameSite(request)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (Number(request.headers.get("content-length")) > ASSET_MAX_BYTES) {
    return Response.json({ error: "too-large" }, { status: 413 });
  }
  const bytes = await readCapped(request.body, ASSET_MAX_BYTES);
  if (!bytes) return Response.json({ error: "too-large" }, { status: 413 });
  try {
    const asset = await saveAsset(sql, user.sub, bytes);
    return Response.json(asset, { status: 201 });
  } catch (error) {
    if (!(error instanceof AssetError)) throw error;
    return Response.json({ error: error.code }, { status: STATUS[error.code] });
  }
}
