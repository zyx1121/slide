// The MCP server: tools a member's agent uses on the member's own decks.
// Every tool runs as the member the access token names; decks of other
// members are not there, as in the web app.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type postgres from "postgres";
import * as z from "zod";

import { slideAssetUris } from "../assets/store";
import { DeckError } from "../deck/errors";
import { getSelection } from "../deck/selection";
import { getDeck, listDecks, mutateDeck } from "../deck/store";
import { shapeBounds, unionRects } from "../editor/geometry";
import { plainText } from "../editor/text-edit";
import {
  backgroundDataUri,
  RenderBusyError,
  renderPngAsync,
} from "../render/png";
import { holdsText, renderSlideSvg } from "../render/svg";
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
import { inSpan } from "../otel/span";

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
  "Shapes follow the deck document (see get_deck): rect, roundRect (corner 0 to 0.5), ellipse, preset (geometry: triangle, rtTriangle, diamond, parallelogram, trapezoid, homePlate, chevron, rightArrow, leftArrow, upArrow, downArrow, leftRightArrow, upDownArrow, leftBracket, rightBracket, bentArrow or flowChartSummingJunction), freeform (path: SVG path data with absolute M, L, C, Q and Z, coordinates 0 to 1000 across the box) and text have x, y, w, h (px on 1920 x 1080), optional rotation, fill (#rrggbb or null), stroke ({ color, width, dash }) and text ({ paragraphs: [{ runs: [{ text, size, color, bold, italic, underline }], align, bullet, level }], anchor }); text needs text. line has route (straight, elbow, curved), start and end ({ x, y } or { shape, site } with site 0 top, 1 left, 2 bottom, 3 right), stroke, startArrow and endArrow. Sizes are px: 18 pt is 36.";

const DeckId = z
  .string()
  .regex(/^dk_[0-9a-z]{2,48}$/)
  .describe("A deck id from list_decks, such as dk_k4m9x2qa7b");

export function createServer(context: ToolContext): McpServer {
  const server = new McpServer(
    { name: "slide", version: "0.1.0" },
    {
      instructions:
        "Slide decks of the signed-in member. A deck is a JSON document: slides with a title and shapes (rect, roundRect, ellipse, preset, freeform, text, image, line) placed in px on a 1920 x 1080 canvas; every shape has a stable id. Use list_decks, then get_deck for the document, render_slide to see a slide, and check_deck for the lab's slide rules. Edits (add_shapes, update_shapes, delete_shapes, add_slide, delete_slide, move_slide) address shapes and slides by id and arrive as suggestions the member accepts or rejects in the editor; render_slide shows the deck as it is, without pending suggestions.",
    }
  );
  const { db, sub } = context;
  // Every tool call is a span: its name and whether it failed, never its
  // arguments or results.
  const registerTool = server.registerTool.bind(server);
  type Handler = (...args: unknown[]) => Promise<{ isError?: boolean }>;
  server.registerTool = ((name: string, config: unknown, handler: Handler) =>
    registerTool(
      name,
      config as never,
      ((...args: unknown[]) =>
        inSpan(`mcp ${name}`, { "mcp.tool": name }, async (set) => {
          const result = await handler(...args);
          set({ "mcp.is_error": Boolean(result?.isError) });
          return result;
        })) as never
    )) as typeof server.registerTool;

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

  server.registerTool(
    "get_selection",
    {
      title: "Get the member's selection",
      description:
        "What the member has selected in the editor right now: the deck, the slide, and the selected shapes as JSON (with the selected words when part of a text is selected), plus a PNG of that part of the slide. With nothing selected, the slide in view. Edit the shapes by their ids; the selection may change while you work.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const selected = await getSelection(db, sub);
      if (!selected) {
        return failure("The member has no deck open in the editor.");
      }
      const deck = await getDeck(db, sub, selected.deckId);
      const index =
        deck?.document.slides.findIndex((s) => s.id === selected.slideId) ?? -1;
      const page = deck?.document.slides[index];
      if (!deck || !page)
        return failure("The selected slide is no longer there.");
      const byId = new Map(page.shapes.map((shape) => [shape.id, shape]));
      const targets = selected.targets
        .map((target) => {
          const shape = byId.get(target.shape);
          if (!shape) return null;
          const words =
            target.text && holdsText(shape) && shape.text
              ? plainText(shape.text, target.text.from, target.text.to)
              : undefined;
          return {
            shape,
            ...(target.text ? { text: target.text, words } : {}),
          };
        })
        .filter((target) => target !== null);

      // The picture: the selected shapes with some room around them, or the
      // whole slide.
      const bounds = unionRects(
        targets.map(({ shape }) => shapeBounds(shape, byId))
      );
      const margin = 40;
      const crop = bounds
        ? {
            x: Math.max(0, bounds.x - margin),
            y: Math.max(0, bounds.y - margin),
            w:
              Math.min(1920, bounds.x + bounds.w + margin) -
              Math.max(0, bounds.x - margin),
            h:
              Math.min(1080, bounds.y + bounds.h + margin) -
              Math.max(0, bounds.y - margin),
          }
        : { x: 0, y: 0, w: 1920, h: 1080 };
      const assets = await slideAssetUris(db, sub, page);
      const svg = renderSlideSvg(page, {
        slideNumber: index + 1,
        background: backgroundDataUri(),
        assetHref: (sha256) => assets.get(sha256) ?? null,
      }).replace(
        /^<svg ([^>]*?)viewBox="0 0 1920 1080" width="1920" height="1080"/,
        `<svg $1viewBox="${crop.x} ${crop.y} ${Math.max(1, crop.w)} ${Math.max(1, crop.h)}" width="${Math.max(1, crop.w)}" height="${Math.max(1, crop.h)}"`
      );
      const summary = {
        deck: { id: deck.id, title: deck.title, version: deck.version },
        slide: { number: index + 1, id: page.id, title: page.title },
        targets,
        selectedAt: selected.updatedAt.toISOString(),
      };
      try {
        const png = await renderPngAsync(
          svg,
          Math.round(Math.min(1280, Math.max(320, crop.w)))
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(summary, null, 2) },
            {
              type: "image" as const,
              data: png.toString("base64"),
              mimeType: "image/png",
            },
          ],
        };
      } catch (error) {
        if (!(error instanceof RenderBusyError)) throw error;
        return text(summary);
      }
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
