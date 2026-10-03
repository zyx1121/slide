import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { sampleDocument } from "@/lib/deck/sample";
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
      "check_deck",
      "get_deck",
      "list_decks",
      "render_slide",
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
});
