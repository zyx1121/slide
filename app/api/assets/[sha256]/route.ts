import { getSession } from "@/lib/auth/session";
import { readAsset } from "@/lib/assets/store";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/assets/:sha256: an image the member uploaded. Content never
 * changes for an id, so the browser may keep it; it is served as the type
 * its bytes were checked to be, never sniffed, and sandboxed.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/assets/[sha256]">
) {
  const user = await getSession();
  if (!user) return Response.json({ error: "sign in first" }, { status: 401 });
  const { sha256 } = await params;
  const asset = await readAsset(sql, user.sub, sha256);
  if (!asset) return Response.json({ error: "no such image" }, { status: 404 });
  return new Response(new Uint8Array(asset.data), {
    headers: {
      "content-type": asset.mime,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
