// Limits shared by the schema and the forms that edit it. This module has no
// dependencies, so client components can import it without pulling in zod.

/** The longest deck title, in UTF-16 code units (JavaScript string length). */
export const DECK_TITLE_MAX = 200;

/** The largest image a member may upload: 10 MB. */
export const ASSET_MAX_BYTES = 10 * 1024 * 1024;

/**
 * The most text one shape and one slide may hold, in UTF-16 code units. A
 * slide's text is laid out on every render, so these keep any valid deck to
 * a few seconds of rendering on the server.
 */
export const SHAPE_TEXT_MAX = 5_000;
export const SLIDE_TEXT_MAX = 20_000;

/** The longest speaker notes of a slide; never laid out, so they can be long. */
export const NOTES_MAX = 50_000;
/** The largest .pptx a member may import: 100 MB. */
export const IMPORT_MAX_BYTES = 100 * 1024 * 1024;
