// The MCP server: tools a member's agent uses on the member's own decks.
// Every tool runs as the member the access token names; decks of other
// members are not there, as in the web app.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type postgres from "postgres";
import * as z from "zod";

import packageJson from "../../package.json";

import {
  AssetError,
  readAsset,
  saveAsset,
  slideAssetUris,
} from "../assets/store";
import { ASSET_MAX_BYTES, DECK_TITLE_MAX, NOTES_MAX } from "../deck/limits";
import {
  actOnDeck,
  type DeckAction,
  listRevisions,
  revertRevision,
} from "../deck/revisions";
import {
  addComment,
  addToThread,
  Body,
  type CommentResult,
  listThreads,
} from "../deck/comments";
import { getSelection, Target } from "../deck/selection";
import {
  blankDocument,
  createDeck,
  type Deck,
  getDeck,
  listDecks,
  listDeletedDecks,
} from "../deck/store";
import { shapeBounds, unionRects } from "../editor/geometry";
import { plainText } from "../editor/text-edit";
import {
  backgroundDataUri,
  RenderBusyError,
  renderPngAsync,
} from "../render/png";
import { holdsText, renderSlideSvg } from "../render/svg";
import { TEMPLATE_IDS, templateOf } from "../render/template";
import { importDeck } from "../pptx/import-deck";
import { fileName, pptxBytes } from "../pptx/response";
import { checkDeck } from "../rules/check";
import {
  addShapes,
  addSlide,
  copySlide,
  deleteShapes,
  findSlide,
  deleteSlide,
  moveSlide,
  type Planned,
  retemplate,
  retitle,
  setSlideNotes,
  setSlideTitle,
  updateShapes,
  WriteError,
} from "./write";
import { inSpan } from "../otel/span";
import { editDeck } from "./edit";

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

/** The most a .pptx sent over MCP may weigh: base64 in a JSON body. */
export const MCP_IMPORT_MAX_BYTES = 20 * 1024 * 1024;

/** The largest .pptx export_deck returns; larger ones are downloaded in the editor. */
const MCP_EXPORT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Bytes from base64 (line breaks allowed, as the base64 command writes it),
 * or null when the text is not base64 or too long.
 */
function fromBase64(raw: string, max: number): Buffer | null {
  const data = raw.replace(/\s+/g, "");
  if (data.length > Math.ceil((max * 4) / 3) + 4) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  const bytes = Buffer.from(data, "base64");
  return bytes.length > 0 && bytes.length <= max ? bytes : null;
}

const EntryId = z
  .string()
  .regex(/^[0-9]{1,18}$/)
  .describe("An entry id from list_history");

const DeckId = z
  .string()
  .regex(/^dk_[0-9a-z]{2,48}$/)
  .describe("A deck id from list_decks, such as dk_k4m9x2qa7b");

export function createServer(context: ToolContext): McpServer {
  const server = new McpServer(
    { name: "slide", version: packageJson.version },
    {
      instructions:
        "Slide decks of the signed-in member; everything the member can do in the editor is a tool here. A deck is a JSON document: slides with a title, speaker notes and shapes (rect, roundRect, ellipse, preset, freeform, text, image, line) placed in px on a 1920 x 1080 canvas; every shape has a stable id. The deck's template (plain, or winlab when the document says so) draws each slide's background, title and number. Use list_decks, then get_deck for the document, render_slide to see a slide, check_deck for the slide rules, get_selection for what the member points at, and list_comments for what they asked for: answer each comment with edits, reply_comment naming the entry that answers it, then resolve_comment. Every change applies at once, the member's and yours alike, and is recorded in the deck's history: list_history shows it and revert undoes any one edit (publishing and deleting are undone by their opposite tools), so prefer acting and reverting over asking. create_deck, import_deck and upload_image (for picture shapes) add; export_deck returns a .pptx.",
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
        "The member's decks, newest first: id, title, slide count, version, whether published, last update. With deleted, the decks the member deleted instead, which restore_deck brings back.",
      inputSchema: { deleted: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ deleted }) => {
      if (deleted) {
        const gone = await listDeletedDecks(db, sub);
        return text(
          gone.map((deck) => ({
            id: deck.id,
            title: deck.title,
            deletedAt: deck.deletedAt.toISOString(),
          }))
        );
      }
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
      const svg = await slideSvg(deck, slide - 1);
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
        "The deck's violations of the slide rules (font size, overflow, overlapping text, connectors through text, contrast, shapes off the slide, and on the WinLab template its palette), each with its slide, shape id, rule and message.",
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

  /** A slide as SVG for a PNG: its pictures inline, the template drawn in. */
  const slideSvg = async (deck: Deck, index: number) => {
    const page = deck.document.slides[index];
    const assets = await slideAssetUris(db, sub, page);
    const template = templateOf(deck.document).id;
    return renderSlideSvg(page, {
      slideNumber: index + 1,
      template,
      background: backgroundDataUri(template),
      assetHref: (sha256) => assets.get(sha256) ?? null,
    });
  };

  /**
   * A PNG of part of a slide: the shapes named, with some room around them,
   * or the whole slide; null while rendering is busy.
   */
  const cropOf = async (deck: Deck, index: number, shapeIds: string[]) => {
    const page = deck.document.slides[index];
    const byId = new Map(page.shapes.map((shape) => [shape.id, shape]));
    const bounds = unionRects(
      shapeIds
        .map((id) => byId.get(id))
        .filter((shape) => shape !== undefined)
        .map((shape) => shapeBounds(shape, byId))
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
    const svg = (await slideSvg(deck, index)).replace(
      /^<svg ([^>]*?)viewBox="0 0 1920 1080" width="1920" height="1080"/,
      `<svg $1viewBox="${crop.x} ${crop.y} ${Math.max(1, crop.w)} ${Math.max(1, crop.h)}" width="${Math.max(1, crop.w)}" height="${Math.max(1, crop.h)}"`
    );
    try {
      const png = await renderPngAsync(
        svg,
        Math.round(Math.min(1280, Math.max(320, crop.w)))
      );
      return png.toString("base64");
    } catch (error) {
      if (!(error instanceof RenderBusyError)) throw error;
      return null;
    }
  };

  /** Targets as they stand now: each shape's JSON, and the words selected. */
  const resolveTargets = (
    page: Deck["document"]["slides"][number],
    targets: Target[]
  ) => {
    const byId = new Map(page.shapes.map((shape) => [shape.id, shape]));
    return targets.map((target) => {
      const shape = byId.get(target.shape);
      if (!shape) return { shape: target.shape, gone: true };
      if (!target.text) return { shape };
      // The words may have gone since: a paragraph removed, the text
      // shortened. Then the range is stale and has no words.
      const body = holdsText(shape) ? shape.text : undefined;
      const paragraphs = body?.paragraphs.length ?? 0;
      const fits =
        body &&
        target.text.from.p < paragraphs &&
        target.text.to.p < paragraphs;
      return fits
        ? {
            shape,
            text: target.text,
            words: plainText(body, target.text.from, target.text.to),
          }
        : { shape, text: target.text, stale: true };
    });
  };

  server.registerTool(
    "get_selection",
    {
      title: "Get the member's selection",
      description:
        "What the member has selected in the editor right now: the deck, the slide, and the selected shapes as JSON (with the selected words when part of a text is selected), the open comments on them, plus a PNG of that part of the slide. With nothing selected, the slide in view. Edit the shapes by their ids; the selection may change while you work.",
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
      const targets = resolveTargets(page, selected.targets).filter(
        (target) => !("gone" in target)
      );
      // Open comments on this slide that touch what is selected (all of the
      // slide's when nothing is).
      const chosen = new Set(selected.targets.map((target) => target.shape));
      const comments = (
        await listThreads(db, sub, deck.id, { status: "open" })
      ).filter(
        (thread) =>
          thread.slideId === page.id &&
          (chosen.size === 0 ||
            thread.targets.length === 0 ||
            thread.targets.some((target) => chosen.has(target.shape)))
      );
      const summary = {
        deck: { id: deck.id, title: deck.title, version: deck.version },
        slide: { number: index + 1, id: page.id, title: page.title },
        targets,
        comments,
        selectedAt: selected.updatedAt.toISOString(),
      };
      const png = await cropOf(
        deck,
        index,
        selected.targets.map((target) => target.shape)
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(summary, null, 2) },
          ...(png
            ? [{ type: "image" as const, data: png, mimeType: "image/png" }]
            : []),
        ],
      };
    }
  );

  /** An edit applied as the agent; see edit.ts. */
  const edit = async (
    deck_id: string,
    plan: (document: Parameters<typeof addShapes>[0]) => Planned
  ) => {
    const outcome = await editDeck(db, sub, deck_id, plan);
    if (!outcome.ok) return failure(outcome.message);
    return text({
      status: "applied",
      entry: outcome.entry,
      version: outcome.version,
      created: outcome.created,
      changed: outcome.changed,
    });
  };

  const shapeList = z.array(z.record(z.string(), z.unknown())).min(1).max(200);

  server.registerTool(
    "add_shapes",
    {
      title: "Add shapes",
      description: `Adds shapes on top of a slide. ${SHAPES_HELP} Ids are given by the deck; one you choose is kept only when free, and connector ends may refer to it.`,
      inputSchema: { deck_id: DeckId, slide: SlideRef, shapes: shapeList },
    },
    async ({ deck_id, slide, shapes }) =>
      edit(deck_id, (document) => addShapes(document, slide, shapes))
  );

  server.registerTool(
    "update_shapes",
    {
      title: "Update shapes",
      description:
        "Changes shapes by id: each field in set replaces the shape's (null removes an optional field; fill or stroke null means none). Fields as add_shapes describes them.",
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
      edit(deck_id, (document) => updateShapes(document, slide, updates))
  );

  server.registerTool(
    "delete_shapes",
    {
      title: "Delete shapes",
      description:
        "Deletes shapes by id. Connectors glued to them stay, with those ends left where they were.",
      inputSchema: {
        deck_id: DeckId,
        slide: SlideRef,
        ids: z.array(z.string().max(64)).min(1).max(200),
      },
    },
    async ({ deck_id, slide, ids }) =>
      edit(deck_id, (document) => deleteShapes(document, slide, ids))
  );

  server.registerTool(
    "add_slide",
    {
      title: "Add a slide",
      description:
        "Adds a slide on the deck's template: after slide number after (0 puts it first; last by default), with a title, optional speaker notes and optional shapes, as add_shapes describes them.",
      inputSchema: {
        deck_id: DeckId,
        after: z.number().int().min(0).max(500).optional(),
        title: z.string().max(500).optional(),
        notes: z.string().max(NOTES_MAX).optional(),
        shapes: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
      },
    },
    async ({ deck_id, after, title, notes, shapes }) =>
      edit(deck_id, (document) =>
        addSlide(document, { after, title, notes, shapes })
      )
  );

  server.registerTool(
    "delete_slide",
    {
      title: "Delete a slide",
      description: "Deletes a slide. A deck keeps at least one.",
      inputSchema: { deck_id: DeckId, slide: SlideRef },
    },
    async ({ deck_id, slide }) =>
      edit(deck_id, (document) => deleteSlide(document, slide))
  );

  server.registerTool(
    "set_slide_title",
    {
      title: "Set a slide's title",
      description:
        "Sets a slide's title, which the deck's template draws; an empty title leaves the slide without one, and a line break starts a new line.",
      inputSchema: {
        deck_id: DeckId,
        slide: SlideRef,
        title: z.string().max(500),
      },
    },
    async ({ deck_id, slide, title }) =>
      edit(deck_id, (document) => setSlideTitle(document, slide, title))
  );

  server.registerTool(
    "set_slide_notes",
    {
      title: "Set a slide's speaker notes",
      description:
        "Sets a slide's speaker notes: plain text, line breaks kept, shown below the slides in the presenter view and never on the projected slide. Empty notes remove them.",
      inputSchema: {
        deck_id: DeckId,
        slide: SlideRef,
        notes: z.string().max(NOTES_MAX),
      },
    },
    async ({ deck_id, slide, notes }) =>
      edit(deck_id, (document) => setSlideNotes(document, slide, notes))
  );

  server.registerTool(
    "move_slide",
    {
      title: "Move a slide",
      description: "Moves a slide so that it becomes slide number to.",
      inputSchema: {
        deck_id: DeckId,
        slide: SlideRef,
        to: z.number().int().min(1).max(500),
      },
    },
    async ({ deck_id, slide, to }) =>
      edit(deck_id, (document) => moveSlide(document, slide, to))
  );

  // ---------------------------------------------------- decks and files

  server.registerTool(
    "create_deck",
    {
      title: "Create a deck",
      description:
        "Creates a deck of one empty slide and returns its id. Template plain unless winlab is asked for.",
      inputSchema: {
        title: z.string().trim().min(1).max(DECK_TITLE_MAX).optional(),
        template: z.enum(TEMPLATE_IDS).optional(),
      },
    },
    async ({ title, template }) => {
      const document = blankDocument(title);
      if (template) document.template = template;
      const deck = await createDeck(db, sub, document);
      return text({ id: deck.id, title: deck.title, version: deck.version });
    }
  );

  server.registerTool(
    "import_deck",
    {
      title: "Import a .pptx",
      description: `Makes a .pptx into a new deck, its pictures stored as the member's, and returns the deck's id and a report of what was left out. data is the file in base64, at most ${MCP_IMPORT_MAX_BYTES / 1024 / 1024} MiB; larger files go through the editor's 匯入.`,
      inputSchema: {
        data: z.string().min(1),
        file_name: z.string().max(255).optional(),
      },
    },
    async ({ data, file_name }) => {
      const bytes = fromBase64(data, MCP_IMPORT_MAX_BYTES);
      if (!bytes) {
        return failure(
          `data must be a base64 .pptx of at most ${MCP_IMPORT_MAX_BYTES} bytes.`
        );
      }
      const result = await importDeck(db, sub, bytes, {
        fallbackTitle: file_name?.replace(/\.pptx$/i, "").trim() || undefined,
        source: "mcp:import_deck",
      });
      return result.ok
        ? text({ id: result.deckId, report: result.report })
        : failure(`The import failed: ${result.code}.`);
    }
  );

  server.registerTool(
    "upload_image",
    {
      title: "Upload a picture",
      description: `Stores a PNG, JPEG or GIF (base64, at most ${ASSET_MAX_BYTES / 1024 / 1024} MiB) as the member's and returns its sha256, width and height; an image shape names it as asset.`,
      inputSchema: { data: z.string().min(1) },
    },
    async ({ data }) => {
      const bytes = fromBase64(data, ASSET_MAX_BYTES);
      if (!bytes) {
        return failure(
          `data must be a base64 picture of at most ${ASSET_MAX_BYTES} bytes.`
        );
      }
      try {
        return text(await saveAsset(db, sub, bytes));
      } catch (error) {
        if (!(error instanceof AssetError)) throw error;
        return failure(`The picture was refused: ${error.code}.`);
      }
    }
  );

  server.registerTool(
    "get_image",
    {
      title: "Get a picture",
      description:
        "One of the member's pictures by its sha256 (an image shape's asset), as an image.",
      inputSchema: { sha256: z.string().regex(/^[0-9a-f]{64}$/) },
      annotations: { readOnlyHint: true },
    },
    async ({ sha256 }) => {
      const asset = await readAsset(db, sub, sha256);
      if (!asset) return failure(`No picture ${sha256} among the member's.`);
      return {
        content: [
          {
            type: "image" as const,
            data: Buffer.from(asset.data).toString("base64"),
            mimeType: asset.mime,
          },
        ],
      };
    }
  );

  server.registerTool(
    "export_deck",
    {
      title: "Export a deck",
      description:
        "The deck as a .pptx file, with the member's pictures embedded, returned as an embedded resource.",
      inputSchema: { deck_id: DeckId },
      annotations: { readOnlyHint: true },
    },
    async ({ deck_id }) => {
      const deck = await getDeck(db, sub, deck_id);
      if (!deck) return failure(`No deck ${deck_id} among the member's decks.`);
      const bytes = await pptxBytes(db, deck);
      if (bytes.length > MCP_EXPORT_MAX_BYTES) {
        return failure(
          `The .pptx is ${bytes.length} bytes, over the ${MCP_EXPORT_MAX_BYTES} an agent can be sent; download it from the editor.`
        );
      }
      return {
        content: [
          {
            type: "resource" as const,
            resource: {
              uri: `slide://decks/${deck.id}/${encodeURIComponent(fileName(deck.title))}`,
              mimeType:
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              blob: Buffer.from(bytes).toString("base64"),
            },
          },
        ],
      };
    }
  );

  server.registerTool(
    "rename_deck",
    {
      title: "Rename a deck",
      description: "Renames the deck.",
      inputSchema: {
        deck_id: DeckId,
        title: z.string().trim().min(1).max(DECK_TITLE_MAX),
      },
    },
    async ({ deck_id, title }) =>
      edit(deck_id, (document) => retitle(document, title))
  );

  server.registerTool(
    "set_template",
    {
      title: "Switch template",
      description:
        "Puts the deck on another template: plain (white, black title) or winlab (the WinLab master).",
      inputSchema: { deck_id: DeckId, template: z.enum(TEMPLATE_IDS) },
    },
    async ({ deck_id, template }) =>
      edit(deck_id, (document) => retemplate(document, template))
  );

  server.registerTool(
    "copy_slide",
    {
      title: "Copy a slide",
      description:
        "Copies a slide right after it, with new ids for it and its shapes.",
      inputSchema: { deck_id: DeckId, slide: SlideRef },
    },
    async ({ deck_id, slide }) =>
      edit(deck_id, (document) => copySlide(document, slide))
  );

  /** A deck action by the agent, applied and recorded. */
  const deckAction = async (deck_id: string, action: DeckAction) => {
    const result = await actOnDeck(db, sub, deck_id, action, "agent");
    switch (result.outcome) {
      case "gone":
        return failure(`No deck ${deck_id} among the member's decks.`);
      case "already":
        return text({ status: "unchanged", note: "Nothing to do." });
      case "applied":
        return text({ status: "applied", entry: result.revisionId });
    }
  };

  server.registerTool(
    "publish_deck",
    {
      title: "Publish a deck",
      description:
        "Publishes the deck at a public link anyone can open (get it from list_decks); unpublish_deck stops it.",
      inputSchema: { deck_id: DeckId },
    },
    async ({ deck_id }) => deckAction(deck_id, "publish")
  );

  server.registerTool(
    "unpublish_deck",
    {
      title: "Unpublish a deck",
      description: "Stops the deck's public link at once.",
      inputSchema: { deck_id: DeckId },
    },
    async ({ deck_id }) => deckAction(deck_id, "unpublish")
  );

  server.registerTool(
    "delete_deck",
    {
      title: "Delete a deck",
      description:
        "Deletes the deck: it leaves the lists and its public link stops, but it stays, history and all, and restore_deck brings it back.",
      inputSchema: { deck_id: DeckId },
    },
    async ({ deck_id }) => deckAction(deck_id, "delete")
  );

  server.registerTool(
    "restore_deck",
    {
      title: "Restore a deck",
      description:
        "Brings back a deleted deck (list_decks with deleted), as it was, public link included if it had one.",
      inputSchema: {
        deck_id: z.string().regex(/^dk_[0-9a-z]{2,48}$/),
      },
    },
    async ({ deck_id }) => deckAction(deck_id, "restore")
  );

  // ------------------------------------------------------------- review

  server.registerTool(
    "list_history",
    {
      title: "List history",
      description:
        "The deck's history, newest first: every change, the member's and agents', each with its id (an entry for revert), kind (edit, publish, unpublish, delete, restore), status, author, the versions it went from and to, and when.",
      inputSchema: {
        deck_id: DeckId,
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ deck_id, limit }) => {
      const deck = await getDeck(db, sub, deck_id);
      if (!deck) return failure(`No deck ${deck_id} among the member's decks.`);
      const history = await listRevisions(db, sub, deck_id, limit ?? 50);
      return text({ version: deck.version, history });
    }
  );

  server.registerTool(
    "revert",
    {
      title: "Revert a change",
      description:
        "Undoes one applied edit from list_history as a new entry: its inverse, refused when a later edit changed the same place. Publishing, unpublishing, deleting and restoring are listed too, and undone with unpublish_deck, publish_deck, restore_deck and delete_deck.",
      inputSchema: {
        deck_id: z.string().regex(/^dk_[0-9a-z]{2,48}$/),
        entry: EntryId,
      },
    },
    async ({ deck_id, entry }) => {
      const outcome = await revertRevision(db, sub, deck_id, entry, "agent");
      if (outcome.outcome === "gone") {
        return failure(`No such entry ${entry} in deck ${deck_id}.`);
      }
      return outcome.outcome === "conflict"
        ? failure(outcome.message)
        : text(outcome);
    }
  );

  // ----------------------------------------------------------- comments

  /** What a comment write answers the agent. */
  const commented = (result: CommentResult, deck_id: string) => {
    switch (result.outcome) {
      case "added":
        return text({ status: "added", id: result.id });
      case "unchanged":
        return text({ status: "unchanged" });
      case "gone":
        return failure(`No such comment or deck ${deck_id}.`);
      case "invalid":
        return failure(result.message);
    }
  };

  server.registerTool(
    "list_comments",
    {
      title: "List comments",
      description:
        "The deck's comment threads, oldest first (open ones unless status says otherwise): each with its slide number, the shapes it is on as they stand now (with the words when it is on part of a text), its replies, resolves and reopens. With images, a PNG of each thread's shapes. The member comments in batches; answer each with your edits, then reply_comment naming the entry that answers it and resolve_comment.",
      inputSchema: {
        deck_id: DeckId,
        status: z.enum(["open", "resolved", "all"]).optional(),
        images: z.boolean().optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("The latest threads to list; 50 by default"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ deck_id, status, images, limit }) => {
      const deck = await getDeck(db, sub, deck_id);
      if (!deck) return failure(`No deck ${deck_id} among the member's decks.`);
      const threads = await listThreads(db, sub, deck_id, {
        status: status === "all" ? undefined : (status ?? "open"),
        limit: limit ?? 50,
      });
      const content: (
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      )[] = [];
      const listed = [];
      for (const thread of threads) {
        const index = deck.document.slides.findIndex(
          (slide) => slide.id === thread.slideId
        );
        const page = deck.document.slides[index];
        listed.push({
          ...thread,
          slide: page ? { number: index + 1, title: page.title } : null,
          targets: page ? resolveTargets(page, thread.targets) : [],
        });
        // At most 10 pictures, so a long list stays a few MB at most.
        if (images && page && content.length < 20) {
          const png = await cropOf(
            deck,
            index,
            thread.targets.map((target) => target.shape)
          );
          if (png) {
            content.push({ type: "text", text: `Comment ${thread.id}:` });
            content.push({ type: "image", data: png, mimeType: "image/png" });
          }
        }
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(listed, null, 2) },
          ...content,
        ],
      };
    }
  );

  server.registerTool(
    "add_comment",
    {
      title: "Comment",
      description:
        "Starts a comment thread on a slide, and on shapes of it (each optionally with a text range: from and to as { p: paragraph, o: offset }), as the editor's comments do.",
      inputSchema: {
        deck_id: DeckId,
        slide: SlideRef,
        targets: z.array(Target).max(1000).optional(),
        body: Body,
      },
    },
    async ({ deck_id, slide, targets, body }) => {
      const deck = await getDeck(db, sub, deck_id);
      if (!deck) return failure(`No deck ${deck_id} among the member's decks.`);
      let slideId: string;
      try {
        slideId = findSlide(deck.document, slide).slide.id;
      } catch (error) {
        if (error instanceof WriteError) return failure(error.message);
        throw error;
      }
      return commented(
        await addComment(
          db,
          sub,
          deck_id,
          { slideId, targets: targets ?? [], body },
          "agent"
        ),
        deck_id
      );
    }
  );

  const CommentId = z
    .string()
    .regex(/^[0-9]{1,18}$/)
    .describe("A thread's id from list_comments");

  server.registerTool(
    "reply_comment",
    {
      title: "Reply to a comment",
      description:
        "Replies in a thread; entry names the change that answers it (from list_history, or the entry an editing tool answered with).",
      inputSchema: {
        deck_id: DeckId,
        comment: CommentId,
        body: Body,
        entry: EntryId.optional(),
      },
    },
    async ({ deck_id, comment, body, entry }) =>
      commented(
        await addToThread(
          db,
          sub,
          deck_id,
          comment,
          { kind: "reply", body, entryId: entry },
          "agent"
        ),
        deck_id
      )
  );

  server.registerTool(
    "resolve_comment",
    {
      title: "Resolve a comment",
      description:
        "Marks a thread resolved; it stays in the record and can be reopened.",
      inputSchema: { deck_id: DeckId, comment: CommentId },
    },
    async ({ deck_id, comment }) =>
      commented(
        await addToThread(
          db,
          sub,
          deck_id,
          comment,
          { kind: "resolve" },
          "agent"
        ),
        deck_id
      )
  );

  server.registerTool(
    "reopen_comment",
    {
      title: "Reopen a comment",
      description: "Opens a resolved thread again.",
      inputSchema: { deck_id: DeckId, comment: CommentId },
    },
    async ({ deck_id, comment }) =>
      commented(
        await addToThread(
          db,
          sub,
          deck_id,
          comment,
          { kind: "reopen" },
          "agent"
        ),
        deck_id
      )
  );

  return server;
}
