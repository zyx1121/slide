// Server only: image assets. Bytes live on a volume under ASSETS_DIR, once
// per sha256; the database records each asset and the members who uploaded
// it. Only those members may read an asset or have it drawn on their slides,
// so an id copied into another member's deck shows a placeholder there.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type postgres from "postgres";

import type { Layout, Slide } from "../deck/schema";
import { slideAssets } from "./drawn";
import { builtinAsset } from "../master/builtin-assets";
import { ASSET_MAX_BYTES } from "../deck/limits";
import { type ImageInfo, sniffImage, withinPixels } from "./image";

type Db = postgres.Sql;

export type Asset = ImageInfo & { sha256: string; bytes: number };

export type AssetErrorCode =
  "empty" | "too-large" | "too-many-pixels" | "unsupported";

export class AssetError extends Error {
  constructor(readonly code: AssetErrorCode) {
    super(code);
  }
}

const SHA256 = /^[0-9a-f]{64}$/;

export function assetsDir(): string {
  return process.env.ASSETS_DIR || join(process.cwd(), "data/assets");
}

/** Where an asset's bytes are: fanned out by the first two hex digits. */
function pathOf(sha256: string): string {
  return join(assetsDir(), sha256.slice(0, 2), sha256);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** What an upload is, or why it cannot be an asset; nothing is stored. */
export function inspectAsset(bytes: Uint8Array): Asset {
  if (bytes.length === 0) throw new AssetError("empty");
  if (bytes.length > ASSET_MAX_BYTES) throw new AssetError("too-large");
  const info = sniffImage(bytes);
  if (!info) throw new AssetError("unsupported");
  if (!withinPixels(info)) throw new AssetError("too-many-pixels");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { sha256, bytes: bytes.length, ...info };
}

/**
 * Stores an upload for a member and returns what it is. The file is written
 * (through a temporary name, then renamed) before the rows, so a row never
 * points at a missing file; the same bytes are kept once.
 */
export async function saveAsset(
  db: Db,
  sub: string,
  bytes: Uint8Array
): Promise<Asset> {
  const asset = inspectAsset(bytes);
  const { sha256, ...info } = asset;
  const path = pathOf(sha256);
  if (!(await exists(path))) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o640 });
    await rename(temporary, path);
  }
  await db.begin(async (tx) => {
    await tx`
      insert into assets (sha256, uploader_sub, mime, bytes, width, height)
      values (${sha256}, ${sub}, ${info.mime}, ${bytes.length},
              ${info.width}, ${info.height})
      on conflict (sha256) do nothing`;
    await tx`
      insert into asset_owners (sha256, sub) values (${sha256}, ${sub})
      on conflict do nothing`;
  });
  return asset;
}

/** An asset's bytes and type, when the member owns it. */
export async function readAsset(
  db: Db,
  sub: string,
  sha256: string
): Promise<{ mime: string; data: Buffer } | null> {
  if (!SHA256.test(sha256)) return null;
  const builtin = builtinAsset(sha256);
  if (builtin) return builtin;
  const [row] = await db<{ mime: string }[]>`
    select a.mime from assets a
    join asset_owners o on o.sha256 = a.sha256
    where a.sha256 = ${sha256} and o.sub = ${sub}`;
  if (!row) return null;
  try {
    return { mime: row.mime, data: await readFile(pathOf(sha256)) };
  } catch {
    return null;
  }
}

/** Which of the given assets the member owns. */
export async function ownedAssets(
  db: Db,
  sub: string,
  shas: string[]
): Promise<Set<string>> {
  // A built-in master's pictures are everyone's.
  const owned = new Set(shas.filter((sha256) => builtinAsset(sha256)));
  const rest = shas.filter((sha256) => !owned.has(sha256));
  if (rest.length === 0) return owned;
  const rows = await db<{ sha256: string }[]>`
    select sha256 from asset_owners
    where sub = ${sub} and sha256 in ${db(rest)}`;
  for (const row of rows) owned.add(row.sha256);
  return owned;
}

/**
 * The most pixels the server decodes for one slide: 100 million. resvg
 * holds every picture of a slide decoded at once, so many pictures under the
 * per-image limit could still take the server's memory.
 */
export const SLIDE_PIXEL_BUDGET = 100_000_000;

/**
 * Data URIs of the slide's assets that `sub` owns, for rendering on the
 * server, where the SVG cannot fetch anything. Pictures past the slide's
 * pixel budget are left out and drawn as placeholders.
 */
export async function slideAssetUris(
  db: Db,
  sub: string,
  slide: Slide,
  layout?: Layout
): Promise<Map<string, string>> {
  const uris = new Map<string, string>();
  const shas = slideAssets(slide, layout);
  if (shas.length === 0) return uris;
  const sizes = await db<{ sha256: string; pixels: number }[]>`
    select a.sha256, a.width::bigint * a.height as pixels from assets a
    join asset_owners o on o.sha256 = a.sha256
    where o.sub = ${sub} and a.sha256 in ${db(shas)}`;
  const pixels = new Map(sizes.map((row) => [row.sha256, Number(row.pixels)]));
  for (const sha256 of shas) {
    const builtin = builtinAsset(sha256);
    if (builtin) pixels.set(sha256, builtin.pixels);
  }
  let budget = SLIDE_PIXEL_BUDGET;
  for (const sha256 of shas) {
    const cost = pixels.get(sha256);
    if (cost === undefined || cost > budget) continue;
    budget -= cost;
    const asset = await readAsset(db, sub, sha256);
    if (asset) {
      uris.set(
        sha256,
        `data:${asset.mime};base64,${asset.data.toString("base64")}`
      );
    }
  }
  return uris;
}
