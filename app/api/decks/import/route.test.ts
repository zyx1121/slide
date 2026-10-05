import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ sql: {} }));
vi.mock("@/lib/deck/store", () => ({
  createDeck: vi.fn(async () => ({ id: "dk_new" })),
}));
vi.mock("@/lib/master/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/master/store")>()),
  saveMaster: vi.fn(),
}));
vi.mock("@/lib/assets/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assets/store")>()),
  saveAsset: vi.fn(),
}));

const { strFromU8, strToU8, unzipSync, zipSync } = await import("fflate");
const { getSession } = await import("@/lib/auth/session");
const { saveAsset } = await import("@/lib/assets/store");
const { createDeck } = await import("@/lib/deck/store");
const { exportPptx } = await import("@/lib/pptx/export");
const { sampleDocument } = await import("@/lib/deck/sample");
const { POST } = await import("./route");

const send = (body: BodyInit, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://app.test/api/decks/import", {
      method: "POST",
      body,
      headers,
      duplex: "half",
    } as RequestInit)
  );

const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  ),
  (ch) => ch.charCodeAt(0)
);

/** The sample deck with a picture on its first slide, and a slide after. */
function deckWithPicture() {
  const doc = sampleDocument();
  const sha256 = createHash("sha256").update(PNG_1X1).digest("hex");
  doc.slides[0].shapes.push({
    id: "im_photo",
    kind: "image",
    x: 100,
    y: 100,
    w: 200,
    h: 200,
    asset: sha256,
  });
  doc.slides.push({ id: "sl_after", title: "After", shapes: [] });
  return {
    doc,
    sha256,
    parts: unzipSync(
      exportPptx(doc, new Map([[sha256, { mime: "image/png", data: PNG_1X1 }]]))
    ),
  };
}

beforeEach(() => {
  vi.mocked(saveAsset).mockReset();
  vi.mocked(getSession).mockResolvedValue({
    sub: "alice",
    name: "Alice",
    email: "",
  });
});

describe("POST /api/decks/import", () => {
  it("makes a deck of the member's from a .pptx", async () => {
    const bytes = exportPptx(sampleDocument(), new Map());
    const response = await send(new Uint8Array(bytes), {
      "x-file-name": encodeURIComponent("報告.pptx"),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "dk_new" });
    expect(createDeck).toHaveBeenCalledWith({}, "alice", expect.any(Object));
  });

  it("stores the pictures of a deck it made, as the member's", async () => {
    const { parts, sha256 } = deckWithPicture();
    const response = await send(new Uint8Array(zipSync(parts)));
    expect(response.status).toBe(201);
    expect(saveAsset).toHaveBeenCalledTimes(1);
    expect(saveAsset).toHaveBeenCalledWith({}, "alice", expect.any(Uint8Array));
    const stored = vi.mocked(saveAsset).mock.calls[0][2];
    expect(createHash("sha256").update(stored).digest("hex")).toBe(sha256);
  });

  it("stores no picture when the file fails after it was read", async () => {
    const { doc, parts } = deckWithPicture();
    // The last slide declares a document type, which the reader refuses;
    // the picture on the first was read already.
    const last = `ppt/slides/slide${doc.slides.length}.xml`;
    expect(parts[last]).toBeDefined();
    parts[last] = strToU8(
      strFromU8(parts[last]).replace("?>", "?><!DOCTYPE p:sld>")
    );
    const response = await send(new Uint8Array(zipSync(parts)));
    expect(response.status).toBe(422);
    expect(saveAsset).not.toHaveBeenCalled();
  });

  it("refuses another site, a signed-out request and a file that is not a deck", async () => {
    expect(
      (await send(new Uint8Array([1]), { origin: "https://evil.test" })).status
    ).toBe(403);
    vi.mocked(getSession).mockResolvedValueOnce(null);
    expect((await send(new Uint8Array([1]))).status).toBe(401);
    expect((await send(new Uint8Array([1, 2, 3]))).status).toBe(422);
  });
});
