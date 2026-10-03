// The MCP server: tools a member's agent uses on the member's own decks.
// Every tool runs as the member the access token names; decks of other
// members are not there, as in the web app.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type postgres from "postgres";
import * as z from "zod";

import { slideAssetUris } from "../assets/store";
import { DeckError } from "../deck/errors";
import { getDeck, listDecks, mutateDeck } from "../deck/store";
import {
  backgroundDataUri,
  RenderBusyError,
  renderPngAsync,
} from "../render/png";
import { renderSlideSvg } from "../render/svg";
import { checkDeck } from "../rules/check";
import {
  addShapes,
  addSlide,
  deleteShapes,
  deleteSlide,
  moveSlide,
  type Planned,
  updateShapes,
  WriteError,
} from "./write";

export type ToolContext = { db: postgres.Sql; sub: string };

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});
const failure = (message: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: message }],
});

const SlideRef = z
  .union([z.number().int().min(1).max(500), z.string().max(64)])
  .describe("The slide: its number from 1, or its id");

const SHAPES_HELP =
  "Shapes follow the deck document (see get_deck): rect, roundRect (corner 0 to 0.5), ellipse and text have x, y, w, h (px on 1920 x 1080), optional rotation, fill (#rrggbb or null), stroke ({ color, width, dash }) and text ({ paragraphs: [{ runs: [{ text, size, color, bold, italic, underline }], align, bullet, level }], anchor }); text needs text. line has route (straight, elbow, curved), start and end ({ x, y } or { shape, site } with site 0 top, 1 left, 2 bottom, 3 right), stroke, startArrow and endArrow. Sizes are px: 18 pt is 36.";

const DeckId = z
  .string()
  .regex(/^dk_[0-9a-z]{2,48}$/)
  .describe("A deck id from list_decks, such as dk_k4m9x2qa7b");

export function createServer(context: ToolContext): McpServer {
  const server = new McpServer(
    { name: "slide.winlab.tw", version: "0.1.0" },
    {
      instructions:
        "Slide decks of the signed-in WinLab member. A deck is a JSON document: slides with a title and shapes (rect, roundRect, ellipse, text, image, line) placed in px on a 1920 x 1080 canvas; every shape has a stable id. Use list_decks, then get_deck for the document, render_slide to see a slide, and check_deck for the lab's slide rules. Edits (add_shapes, update_shapes, delete_shapes, add_slide, delete_slide, move_slide) address shapes and slides by id and arrive as suggestions the member accepts or rejects in the editor; render_slide shows the deck as it is, without pending suggestions.",
    }
  );
  const { db, sub } = context;

  server.registerTool(
    "list_decks",
    {
      title: "List decks",
      description:
        "The member's decks, newest first: id, title, slide count, version, whether published, last update.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const decks = await listDecks(db, sub);
      return text(
        decks.map((deck) => ({
          id: deck.id,
          title: deck.title,
          slides: deck.slideCount,
          version: deck.version,
          published: deck.published,
          updatedAt: deck.updatedAt.toISOString(),
        }))
      );
    }
  );

  server.registerTool(
    "get_deck",
    {
      title: "Get a deck",
      description:
        "A deck's document and version: its slides, each with its title and shapes. Shapes keep their ids for life; address them by id.",
      inputSchema: { deck_id: DeckId },
      annotations: { readOnlyHint: true },
    },
    async ({ deck_id }) => {
      const deck = await getDeck(db, sub, deck_id);
      if (!deck) return failure(`No deck ${deck_id} among the member's decks.`);
      return text({
        id: deck.id,
        version: deck.version,
        document: deck.document,
      });
    }
  );

  server.registerTool(
    "render_slide",
    {
      title: "Render a slide",
      description:
        "One slide drawn as a PNG, as the editor and PowerPoint show it, so you can check its layout.",
      inputSchema: {
        deck_id: DeckId,
        slide: z
          .number()
          .int()
          .min(1)
          .max(500)
          .describe("The slide number, from 1"),
        width: z
          .number()
          .int()
          .min(320)
          .max(1920)
          .optional()
          .describe("Image width in px; 1280 by default"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ deck_id, slide, width }) => {
      const deck = await getDeck(db, sub, deck_id);
      const page = deck?.document.slides[slide - 1];
      if (!deck || !page)
        return failure(`No slide ${slide} in deck ${deck_id}.`);
      const assets = await slideAssetUris(db, sub, page);
      const svg = renderSlideSvg(page, {
        slideNumber: slide,
        background: backgroundDataUri(),
        assetHref: (sha256) => assets.get(sha256) ?? null,
      });
      try {
        const png = await renderPngAsync(svg, width ?? 1280);
        return {
          content: [
            {
              type: "image" as const,
              data: png.toString("base64"),
              mimeType: "image/png",
            },
          ],
        };
      } catch (error) {
        if (!(error instanceof RenderBusyError)) throw error;
        return failure("Rendering is busy; try again in a few seconds.");
      }
    }
  );

  server.registerTool(
    "check_deck",
    {
      title: "Check a deck",
      description:
        "The deck's violations of WinLab's slide rules (font size, palette, overflow, overlapping text, connectors through text, contrast, shapes off the slide), each with its slide, shape id, rule and message.",
      inputSchema: { deck_id: DeckId },
      annotations: { readOnlyHint: true },
    },
    async ({ deck_id }) => {
      const deck = await getDeck(db, sub, deck_id);
      if (!deck) return failure(`No deck ${deck_id} among the member's decks.`);
      const violations = checkDeck(deck.document);
      return text({ deck: deck.id, violations });
    }
  );

  /** Stores a plan as a suggestion the member reviews; nothing changes yet. */
  const suggest = async (
    deck_id: string,
    plan: (document: Parameters<typeof addShapes>[0]) => Planned
  ) => {
    const deck = await getDeck(db, sub, deck_id);
    if (!deck) return failure(`No deck ${deck_id} among the member's decks.`);
    let planned: Planned;
    try {
      planned = plan(deck.document);
    } catch (error) {
      if (error instanceof WriteError) return failure(error.message);
      throw error;
    }
    try {
      const result = await mutateDeck(db, {
        deckId: deck.id,
        actor: { kind: "agent", sub },
        baseVersion: deck.version,
        ops: planned.ops,
      });
      return text({
        status: result.status,
        suggestion: result.revisionId,
        baseVersion: deck.version,
        created: planned.created,
        changed: planned.changed,
        note: "The member sees this as a suggestion in the editor; nothing changes until they accept it.",
      });
    } catch (error) {
      if (!(error instanceof DeckError)) throw error;
      const issues = (error.details as { issues?: string[] }).issues;
      return failure(
        issues?.length
          ? `${error.message}:\n${issues.join("\n")}`
          : error.message
      );
    }
  };

  const shapeList = z.array(z.record(z.string(), z.unknown())).min(1).max(200);

  server.registerTool(
    "add_shapes",
    {
      title: "Add shapes",
      description: `Suggests new shapes on top of a slide. ${SHAPES_HELP} Ids are given by the deck; one you choose is kept only when free, and connector ends may refer to it.`,
      inputSchema: { deck_id: DeckId, slide: SlideRef, shapes: shapeList },
    },
    async ({ deck_id, slide, shapes }) =>
      suggest(deck_id, (document) => addShapes(document, slide, shapes))
  );

  server.registerTool(
    "update_shapes",
    {
      title: "Update shapes",
      description: `Suggests changes to shapes by id: each field in set replaces the shape's (null removes an optional field; fill or stroke null means none). ${SHAPES_HELP}`,
      inputSchema: {
        deck_id: DeckId,
        slide: SlideRef,
        updates: z
          .array(
            z.object({
              id: z.string().max(64),
              set: z.record(z.string(), z.unknown()),
            })
          )
          .min(1)
          .max(200),
      },
    },
    async ({ deck_id, slide, updates }) =>
      suggest(deck_id, (document) => updateShapes(document, slide, updates))
  );

  server.registerTool(
    "delete_shapes",
    {
      title: "Delete shapes",
      description:
        "Suggests deleting shapes by id. Connectors glued to them stay, with those ends left where they were.",
      inputSchema: {
        deck_id: DeckId,
        slide: SlideRef,
        ids: z.array(z.string().max(64)).min(1).max(200),
      },
    },
    async ({ deck_id, slide, ids }) =>
      suggest(deck_id, (document) => deleteShapes(document, slide, ids))
  );

  server.registerTool(
    "add_slide",
    {
      title: "Add a slide",
      description: `Suggests a new slide with the WinLab template: after slide number after (0 puts it first; last by default), with a title and optional shapes. ${SHAPES_HELP}`,
      inputSchema: {
        deck_id: DeckId,
        after: z.number().int().min(0).max(500).optional(),
        title: z.string().max(500).optional(),
        shapes: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
      },
    },
    async ({ deck_id, after, title, shapes }) =>
      suggest(deck_id, (document) =>
        addSlide(document, { after, title, shapes })
      )
  );

  server.registerTool(
    "delete_slide",
    {
      title: "Delete a slide",
      description: "Suggests deleting a slide. A deck keeps at least one.",
      inputSchema: { deck_id: DeckId, slide: SlideRef },
    },
    async ({ deck_id, slide }) =>
      suggest(deck_id, (document) => deleteSlide(document, slide))
  );

  server.registerTool(
    "move_slide",
    {
      title: "Move a slide",
      description:
        "Suggests moving a slide so that it becomes slide number to.",
      inputSchema: {
        deck_id: DeckId,
        slide: SlideRef,
        to: z.number().int().min(1).max(500),
      },
    },
    async ({ deck_id, slide, to }) =>
      suggest(deck_id, (document) => moveSlide(document, slide, to))
  );

  return server;
}
