// The MCP server: tools a member's agent uses on the member's own decks.
// Every tool runs as the member the access token names; decks of other
// members are not there, as in the web app.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type postgres from "postgres";
import * as z from "zod";

import { slideAssetUris } from "../assets/store";
import { getDeck, listDecks } from "../deck/store";
import {
  backgroundDataUri,
  RenderBusyError,
  renderPngAsync,
} from "../render/png";
import { renderSlideSvg } from "../render/svg";
import { checkDeck } from "../rules/check";

export type ToolContext = { db: postgres.Sql; sub: string };

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});
const failure = (message: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: message }],
});

const DeckId = z
  .string()
  .regex(/^dk_[0-9a-z]{2,48}$/)
  .describe("A deck id from list_decks, such as dk_k4m9x2qa7b");

export function createServer(context: ToolContext): McpServer {
  const server = new McpServer(
    { name: "slide.winlab.tw", version: "0.1.0" },
    {
      instructions:
        "Slide decks of the signed-in WinLab member. A deck is a JSON document: slides with a title and shapes (rect, roundRect, ellipse, text, image, line) placed in px on a 1920 x 1080 canvas; every shape has a stable id. Use list_decks, then get_deck for the document, render_slide to see a slide, and check_deck for the lab's slide rules.",
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

  return server;
}
