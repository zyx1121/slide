import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { sampleDocument } from "@/lib/deck/sample";
import { saveSelection } from "@/lib/deck/selection";
import { createDeck, ensureUser } from "@/lib/deck/store";
import { createTestDb, TEST_DATABASE_URL } from "@/lib/test-db";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  get sql() {
    return holder.db;
  },
}));
vi.mock("@/lib/mcp/token", async (original) => ({
  ...(await original<typeof import("@/lib/mcp/token")>()),
  verifyAccessToken: vi.fn(async (_env: unknown, token: string) =>
    token === "good"
      ? { sub: "alice-sub", name: "Alice", email: "", expiresAt: 2e9 }
      : null
  ),
}));

const ENV = {
  APP_URL: "https://slide.example.org",
  KEYCLOAK_ISSUER: "https://auth.example.org/realms/lab",
  SESSION_SECRET: "s".repeat(64),
  MCP_CLIENT_ID: "slide-mcp",
};

const { POST } = await import("./route");

let id = 0;
async function rpc(method: string, params: unknown, token = "good") {
  const response = await POST(
    new Request("https://slide.example.org/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    })
  );
  return { response, body: response.ok ? await response.json() : null };
}

describe("POST /mcp challenges", () => {
  beforeAll(() => Object.assign(process.env, ENV));

  it("asks for a token, naming the resource metadata", async () => {
    const { response } = await rpc("tools/list", {}, "bad");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://slide.example.org/.well-known/oauth-protected-resource/mcp", error="invalid_token"'
    );
  });

  it("is off without an MCP client", async () => {
    delete process.env.MCP_CLIENT_ID;
    expect((await rpc("tools/list", {})).response.status).toBe(404);
    process.env.MCP_CLIENT_ID = ENV.MCP_CLIENT_ID;
  });
});

describe.skipIf(!TEST_DATABASE_URL)("MCP tools (Postgres)", () => {
  let db: postgres.Sql;
  let drop: () => Promise<void>;
  let deckId = "";

  beforeAll(async () => {
    Object.assign(process.env, ENV);
    ({ db, drop } = await createTestDb());
    holder.db = db;
    await ensureUser(db, { sub: "alice-sub", name: "Alice" });
    await ensureUser(db, { sub: "bob-sub", name: "Bob" });
    deckId = (await createDeck(db, "alice-sub", sampleDocument())).id;
    await createDeck(db, "bob-sub", sampleDocument());
  });
  afterAll(async () => {
    await drop?.();
  });

  const call = async (name: string, args: Record<string, unknown>) =>
    (await rpc("tools/call", { name, arguments: args })).body.result;

  it("initializes and lists its tools", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.body.result.serverInfo.name).toBe("slide.winlab.tw");
    const tools = (await rpc("tools/list", {})).body.result.tools;
    expect(tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "add_shapes",
      "add_slide",
      "check_deck",
      "delete_shapes",
      "delete_slide",
      "get_deck",
      "get_selection",
      "list_decks",
      "move_slide",
      "render_slide",
      "update_shapes",
    ]);
  });

  it("lists and reads only the member's decks", async () => {
    const decks = JSON.parse((await call("list_decks", {})).content[0].text);
    expect(decks.map((deck: { id: string }) => deck.id)).toEqual([deckId]);
    const deck = JSON.parse(
      (await call("get_deck", { deck_id: deckId })).content[0].text
    );
    expect(deck.document.title).toBe("Agent Sense");
    const missing = await call("get_deck", { deck_id: "dk_nothere00" });
    expect(missing.isError).toBe(true);
  });

  it("renders a slide and checks the deck", async () => {
    const png = await call("render_slide", {
      deck_id: deckId,
      slide: 1,
      width: 640,
    });
    expect(png.content[0]).toMatchObject({
      type: "image",
      mimeType: "image/png",
    });
    expect(
      Buffer.from(png.content[0].data, "base64").subarray(1, 4).toString()
    ).toBe("PNG");
    const checked = JSON.parse(
      (await call("check_deck", { deck_id: deckId })).content[0].text
    );
    expect(checked).toEqual({ deck: deckId, violations: [] });
  });

  it("stores an agent's edit as a suggestion and leaves the deck as it is", async () => {
    const before = JSON.parse(
      (await call("get_deck", { deck_id: deckId })).content[0].text
    );
    const result = JSON.parse(
      (
        await call("update_shapes", {
          deck_id: deckId,
          slide: 1,
          updates: [{ id: "sh_asr", set: { fill: "#fff2cc" } }],
        })
      ).content[0].text
    );
    expect(result).toMatchObject({ status: "suggested", changed: ["sh_asr"] });
    const after = JSON.parse(
      (await call("get_deck", { deck_id: deckId })).content[0].text
    );
    expect(after.version).toBe(before.version);
    const [row] = await db`
      select status, author_kind from revisions where id = ${result.suggestion}`;
    expect(row).toEqual({ status: "suggested", author_kind: "agent" });
  });

  it("says why an edit cannot be suggested", async () => {
    const bad = await call("add_shapes", {
      deck_id: deckId,
      slide: 1,
      shapes: [{ kind: "rect", x: 0, y: 0, w: 10, h: 10, fill: "red" }],
    });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("colors look like");
  });

  it("reads what the member selected, with the words and a picture of it", async () => {
    const none = await call("get_selection", {});
    expect(none.isError).toBe(true);
    // Another member cannot point Alice's selection at their deck.
    expect(
      await saveSelection(db, "bob-sub", deckId, {
        slideId: "sl_overview",
        targets: [],
      })
    ).toBe(false);
    expect(
      await saveSelection(db, "alice-sub", deckId, {
        slideId: "sl_overview",
        targets: [
          {
            shape: "sh_capture",
            text: { from: { p: 0, o: 0 }, to: { p: 0, o: 5 } },
          },
          { shape: "ln_capture_asr" },
        ],
      })
    ).toBe(true);
    const result = await call("get_selection", {});
    const summary = JSON.parse(result.content[0].text);
    expect(summary.slide).toMatchObject({ number: 1, id: "sl_overview" });
    expect(
      summary.targets.map((t: { shape: { id: string } }) => t.shape.id)
    ).toEqual(["sh_capture", "ln_capture_asr"]);
    expect(summary.targets[0].words).toBe("Audio");
    expect(result.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png",
    });
  });
});
