import { getSession } from "@/lib/auth/session";
import { AssetError, saveAsset } from "@/lib/assets/store";
import { sql } from "@/lib/db";
import { ASSET_MAX_BYTES } from "@/lib/deck/limits";
import { readCapped, sameSite } from "@/lib/http/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS = {
  empty: 400,
  "too-large": 413,
  "too-many-pixels": 413,
  unsupported: 415,
} as const;

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
