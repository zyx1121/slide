// Limits shared by the schema and the forms that edit it. This module has no
// dependencies, so client components can import it without pulling in zod.

/** The longest deck title, in UTF-16 code units (JavaScript string length). */
export const DECK_TITLE_MAX = 200;

/** The largest image a member may upload: 10 MB. */
export const ASSET_MAX_BYTES = 10 * 1024 * 1024;
