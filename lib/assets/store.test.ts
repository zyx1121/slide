import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ASSET_MAX_BYTES } from "../deck/limits";
import { sampleDocument } from "../deck/sample";
import { createTestDb, TEST_DATABASE_URL } from "../test-db";
import { PNG_1X1 } from "./image.test";
import { AssetError, readAsset, saveAsset, slideAssetUris } from "./store";

describe.skipIf(!TEST_DATABASE_URL)("asset store", () => {
  let db: postgres.Sql;
  let drop: () => Promise<void>;
  let dir: string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    dir = await mkdtemp(join(tmpdir(), "slide-assets-"));
    process.env.ASSETS_DIR = dir;
    await db`insert into users (sub) values ('alice'), ('bob'), ('eve')`;
  });
  afterAll(async () => {
    await drop();
    await rm(dir, { recursive: true, force: true });
    delete process.env.ASSETS_DIR;
  });

  it("stores an image once and lets each uploader read it", async () => {
    const first = await saveAsset(db, "alice", PNG_1X1);
    const again = await saveAsset(db, "bob", PNG_1X1);
    expect(again).toEqual(first);
    expect(first).toMatchObject({ mime: "image/png", width: 1, height: 1 });
    expect(await readdir(join(dir, first.sha256.slice(0, 2)))).toEqual([
      first.sha256,
    ]);
    expect((await readAsset(db, "alice", first.sha256))?.data).toEqual(
      Buffer.from(PNG_1X1)
    );
    expect(await readAsset(db, "bob", first.sha256)).not.toBeNull();
  });

  it("keeps an image from members who did not upload it", async () => {
    const { sha256 } = await saveAsset(db, "alice", PNG_1X1);
    expect(await readAsset(db, "eve", sha256)).toBeNull();
    expect(await readAsset(db, "alice", "../../etc/passwd")).toBeNull();
  });

  it("draws only the member's own images on the server", async () => {
    const { sha256 } = await saveAsset(db, "alice", PNG_1X1);
    const slide = {
      ...sampleDocument().slides[0],
      shapes: [
        {
          id: "im_mine",
          kind: "image" as const,
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          asset: sha256,
        },
      ],
    };
    expect((await slideAssetUris(db, "alice", slide)).get(sha256)).toMatch(
      /^data:image\/png;base64,/
    );
    expect((await slideAssetUris(db, "eve", slide)).size).toBe(0);
  });

  it("refuses empty, oversized and unsupported files", async () => {
    const code = async (bytes: Uint8Array) =>
      saveAsset(db, "alice", bytes).catch((error: AssetError) => error.code);
    expect(await code(new Uint8Array())).toBe("empty");
    expect(await code(new Uint8Array(ASSET_MAX_BYTES + 1))).toBe("too-large");
    expect(await code(new TextEncoder().encode("<svg/>"))).toBe("unsupported");
    // A 1 x 1 PNG that declares 10000 x 10000 pixels.
    const bomb = PNG_1X1.slice();
    new DataView(bomb.buffer).setUint32(16, 10000);
    new DataView(bomb.buffer).setUint32(20, 10000);
    expect(await code(bomb)).toBe("too-many-pixels");
  });
});
