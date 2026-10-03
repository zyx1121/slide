// Limits shared by the schema and the forms that edit it. This module has no
// dependencies, so client components can import it without pulling in zod.

/** The longest deck title, in UTF-16 code units (JavaScript string length). */
export const DECK_TITLE_MAX = 200;
