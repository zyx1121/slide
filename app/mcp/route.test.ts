import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
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
vi.mock("@/lib/mcp/grants", async (original) => ({
  ...(await original<typeof import("@/lib/mcp/grants")>()),
  verifyAccessToken: vi.fn(
    async (_db: unknown, _env: unknown, token: string) =>
      token === "good"
        ? { sub: "alice-sub", clientId: "test-client", expiresAt: 2e9 }
        : null
  ),
}));

const ENV = {
  APP_URL: "https://slide.example.org",
  OIDC_ISSUER: "https://accounts.google.com",
  OIDC_CLIENT_ID: "slide",
  OIDC_CLIENT_SECRET: "client-secret",
  SESSION_SECRET: "s".repeat(64),
  ALLOWED_EMAILS: "alice@example.com",
};

const { DELETE, GET, POST } = await import("./route");

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

  it("is off while sign-in is not set up", async () => {
    delete process.env.ALLOWED_EMAILS;
    expect((await rpc("tools/list", {})).response.status).toBe(404);
    process.env.ALLOWED_EMAILS = ENV.ALLOWED_EMAILS;
  });

  const other = (handler: typeof GET, method: string, token: string) =>
    handler(
      new Request("https://slide.example.org/mcp", {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "text/event-stream",
        },
      })
    );

  it("offers no stream and no session: GET and DELETE answer 405", async () => {
    for (const [handler, method] of [
      [GET, "GET"],
      [DELETE, "DELETE"],
    ] as const) {
      const response = await other(handler, method, "good");
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });

  it("still challenges a GET without a valid token", async () => {
    const response = await other(GET, "GET", "bad");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "resource_metadata="
    );
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
    expect(init.body.result.serverInfo.name).toBe("slide");
    const tools = (await rpc("tools/list", {})).body.result.tools;
    expect(tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "add_comment",
      "add_shapes",
      "add_slide",
      "check_deck",
      "copy_slide",
      "create_deck",
      "delete_deck",
      "delete_shapes",
      "delete_slide",
      "export_deck",
      "get_deck",
      "get_image",
      "get_selection",
      "import_deck",
      "list_comments",
      "list_decks",
      "list_history",
      "list_masters",
      "move_slide",
      "publish_deck",
      "rename_deck",
      "render_slide",
      "reopen_comment",
      "reply_comment",
      "resolve_comment",
      "restore_deck",
      "revert",
      "set_master",
      "set_slide_layout",
      "set_slide_notes",
      "set_slide_title",
      "unpublish_deck",
      "update_shapes",
      "upload_image",
    ]);
  });

  it("speaks 2026-07-28 to a client that asks for it", async () => {
    const client = new Client(
      { name: "test", version: "1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL("https://slide.example.org/mcp"),
        {
          fetch: (url, init) => POST(new Request(url, init)),
          requestInit: { headers: { authorization: "Bearer good" } },
        }
      )
    );
    try {
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("list_decks");
      const result = await client.callTool({
        name: "list_decks",
        arguments: {},
      });
      const decks = JSON.parse(
        (result.content as { type: string; text: string }[])[0].text
      );
      expect(decks.map((deck: { id: string }) => deck.id)).toEqual([deckId]);
    } finally {
      await client.close();
    }
  });

  it("opens no subscription stream", async () => {
    const response = await POST(
      new Request("https://slide.example.org/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer good",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "subscriptions/listen",
          params: {},
        }),
      })
    );
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).error.code).toBe(-32601);
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

  it("applies an agent's edit at once and records it as the agent's", async () => {
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
    expect(result).toMatchObject({
      status: "applied",
      version: before.version + 1,
      changed: ["sh_asr"],
    });
    const after = JSON.parse(
      (await call("get_deck", { deck_id: deckId })).content[0].text
    );
    expect(after.version).toBe(before.version + 1);
    const [row] = await db`
      select status, author_kind from revisions where id = ${result.entry}`;
    expect(row).toEqual({ status: "applied", author_kind: "agent" });
  });

  it("says why an edit cannot be made", async () => {
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

  const json = (result: { content: { text: string }[] }) =>
    JSON.parse(result.content[0].text);

  it("does what the editor does: decks, files and masters", async () => {
    const masters = json(await call("list_masters", {}));
    expect(masters.slice(0, 2)).toMatchObject([
      { ref: "plain", name: "空白", layouts: ["Title & Bullets"] },
      { ref: "winlab", name: "WinLab" },
    ]);
    const created = json(
      await call("create_deck", { title: "From an agent", master: "winlab" })
    );
    expect(created).toMatchObject({ title: "From an agent", version: 0 });
    const fresh = json(await call("get_deck", { deck_id: created.id }));
    expect(fresh.document.master.name).toBe("WinLab");
    expect(
      (await call("create_deck", { master: "f".repeat(64) })).isError
    ).toBe(true);

    // Document changes apply at once.
    for (const [tool, args] of [
      ["rename_deck", { title: "Renamed" }],
      ["set_slide_layout", { slide: 1, layout: "Section" }],
      ["set_master", { master: "plain" }],
      ["set_slide_title", { slide: 1, title: "Opening" }],
      ["set_slide_notes", { slide: 1, notes: "Welcome everyone." }],
      ["copy_slide", { slide: 1 }],
    ] as const) {
      const result = json(await call(tool, { deck_id: created.id, ...args }));
      expect(result.status).toBe("applied");
    }
    const changed = json(await call("get_deck", { deck_id: created.id }));
    expect(changed.document.title).toBe("Renamed");
    expect(changed.document.master.name).toBe("空白");
    // The plain master has no Section layout: the slide takes its default.
    expect(changed.document.slides[0].layout).toBeUndefined();
    expect(changed.document.slides).toHaveLength(2);
    expect(
      changed.document.slides.map((slide: { title: string }) => slide.title)
    ).toEqual(["Opening", "Opening"]);
    expect(changed.document.slides[0].notes).toBe("Welcome everyone.");
    expect(
      (await call("set_master", { deck_id: created.id, master: "plain" }))
        .isError
    ).toBe(true);

    // A picture goes up and comes back.
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const asset = json(await call("upload_image", { data: png }));
    expect(asset).toMatchObject({ width: 1, height: 1, mime: "image/png" });
    const image = await call("get_image", { sha256: asset.sha256 });
    expect(image.content[0]).toMatchObject({ type: "image", data: png });
    expect((await call("upload_image", { data: "not base64!" })).isError).toBe(
      true
    );

    // Export, then import what was exported.
    const exported = await call("export_deck", { deck_id: deckId });
    expect(exported.content[0]).toMatchObject({ type: "resource" });
    const blob = exported.content[0].resource.blob as string;
    expect(Buffer.from(blob, "base64").subarray(0, 2).toString()).toBe("PK");
    const imported = json(
      await call("import_deck", { data: blob, file_name: "Again.pptx" })
    );
    expect(imported.id).toMatch(/^dk_/);
    expect(imported.report.slides).toBeGreaterThan(0);
  });

  it("publishes and deletes at once, and undoes either with its opposite", async () => {
    const deck = json(await call("create_deck", { title: "Reviewed" }));
    const published = json(await call("publish_deck", { deck_id: deck.id }));
    expect(published.status).toBe("applied");
    const listed = json(await call("list_decks", {}));
    expect(
      listed.find((item: { id: string }) => item.id === deck.id).published
    ).toBe(true);
    const history = json(await call("list_history", { deck_id: deck.id }));
    expect(history.pending).toBeUndefined();
    expect(history.history[0]).toMatchObject({
      id: published.entry,
      kind: "publish",
      author: "agent",
    });

    // A deck action is undone by its opposite tool, not by revert.
    expect(
      (await call("revert", { deck_id: deck.id, entry: published.entry }))
        .isError
    ).toBe(true);
    expect(
      json(await call("unpublish_deck", { deck_id: deck.id })).status
    ).toBe("applied");

    // Delete moves the deck to the deleted list; restore brings it back.
    const doomed = json(await call("delete_deck", { deck_id: deck.id }));
    expect(doomed.status).toBe("applied");
    expect(
      json(await call("list_decks", { deleted: true })).map(
        (item: { id: string }) => item.id
      )
    ).toContain(deck.id);
    expect((await call("get_deck", { deck_id: deck.id })).isError).toBe(true);
    expect(json(await call("restore_deck", { deck_id: deck.id })).status).toBe(
      "applied"
    );
    expect((await call("get_deck", { deck_id: deck.id })).isError).toBeFalsy();
  });

  it("takes files past the SDK's 4 MiB body cap, up to the tools' own", async () => {
    // Not a picture nor a .pptx: the tools must get to say so, rather than
    // the endpoint refusing the body.
    const big = Buffer.alloc(5 * 1024 * 1024, 7).toString("base64");
    const upload = await call("upload_image", { data: big });
    expect(upload.isError).toBe(true);
    expect(upload.content[0].text).toMatch(/refused/);
    const imported = await call("import_deck", { data: big });
    expect(imported.isError).toBe(true);
    expect(imported.content[0].text).toMatch(/import failed/);
    // Line breaks in base64 are fine.
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const wrapped = png.replace(/(.{20})/g, "$1\n");
    expect(json(await call("upload_image", { data: wrapped })).width).toBe(1);
  });

  it("reads the member's comments and answers them", async () => {
    const deck = json(await call("create_deck", { title: "Commented" }));
    const slideId = json(await call("get_deck", { deck_id: deck.id })).document
      .slides[0].id;
    // The member comments in the editor; here, the same function.
    const { addComment } = await import("@/lib/deck/comments");
    const added = await addComment(db, "alice-sub", deck.id, {
      slideId,
      targets: [],
      body: "Add a title",
    });
    const threadId = (added as { id: string }).id;

    const listed = await call("list_comments", {
      deck_id: deck.id,
      images: true,
    });
    const threads = JSON.parse(listed.content[0].text);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      id: threadId,
      body: "Add a title",
      author: "member",
      status: "open",
      slide: { number: 1 },
    });
    expect(
      listed.content.some((c: { type: string }) => c.type === "image")
    ).toBe(true);

    // The agent answers with an edit, says so, and resolves.
    const titled = json(
      await call("add_slide", { deck_id: deck.id, after: 0, title: "Overview" })
    );
    expect(
      json(
        await call("reply_comment", {
          deck_id: deck.id,
          comment: threadId,
          body: "Added a title slide",
          entry: titled.entry,
        })
      ).status
    ).toBe("added");
    expect(
      json(
        await call("resolve_comment", { deck_id: deck.id, comment: threadId })
      ).status
    ).toBe("added");
    expect(
      JSON.parse(
        (await call("list_comments", { deck_id: deck.id })).content[0].text
      )
    ).toEqual([]);
    const all = JSON.parse(
      (await call("list_comments", { deck_id: deck.id, status: "all" }))
        .content[0].text
    );
    expect(all[0].replies.map((r: { kind: string }) => r.kind)).toEqual([
      "reply",
      "resolve",
    ]);
    expect(all[0].replies[0].entryId).toBe(titled.entry);

    // An agent comments too, and a bad anchor is refused.
    expect(
      json(
        await call("add_comment", {
          deck_id: deck.id,
          slide: 1,
          body: "Check the numbers",
        })
      ).status
    ).toBe("added");
    expect(
      (
        await call("add_comment", {
          deck_id: deck.id,
          slide: 1,
          targets: [{ shape: "sh_ghost" }],
          body: "x",
        })
      ).isError
    ).toBe(true);
    expect(
      json(
        await call("reopen_comment", { deck_id: deck.id, comment: threadId })
      ).status
    ).toBe("added");
  });

  it("lists a comment whose words were deleted since", async () => {
    const deck = await createDeck(db, "alice-sub", sampleDocument());
    const doc = deck.document;
    const slide = doc.slides[0];
    const note = slide.shapes.find((shape) => shape.id === "tx_note")!;
    const { addComment } = await import("@/lib/deck/comments");
    await addComment(db, "alice-sub", deck.id, {
      slideId: slide.id,
      targets: [
        {
          shape: "tx_note",
          text: { from: { p: 5, o: 0 }, to: { p: 5, o: 3 } },
        },
      ],
      body: "Drop this bullet",
    });
    const listed = await call("list_comments", { deck_id: deck.id });
    expect(listed.isError).toBeFalsy();
    const [thread] = JSON.parse(listed.content[0].text);
    expect(thread.targets[0]).toMatchObject({ stale: true });
    expect(note).toBeDefined();
  });

  it("keeps every tool to the member's own decks", async () => {
    const [bobs] = await db<{ id: string }[]>`
      select id from decks where owner_sub = 'bob-sub' limit 1`;
    for (const [tool, args] of [
      ["export_deck", {}],
      ["rename_deck", { title: "Mine" }],
      ["delete_deck", {}],
      ["publish_deck", {}],
      ["list_history", {}],
      ["revert", { entry: "1" }],
      ["list_comments", {}],
      ["add_comment", { slide: 1, body: "x" }],
      ["reply_comment", { comment: "1", body: "x" }],
      ["resolve_comment", { comment: "1" }],
      ["reopen_comment", { comment: "1" }],
    ] as const) {
      const result = await call(tool, { deck_id: bobs.id, ...args });
      expect(result.isError, tool).toBe(true);
    }
  });
});
