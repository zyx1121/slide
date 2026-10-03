export type DeckErrorCode =
  | "not_found" // no such deck, or it belongs to someone else
  | "conflict" // the patch was written against an older version
  | "invalid_patch" // the operations do not apply to the document
  | "invalid_document"; // they apply, but the result breaks the schema

/** A write that was refused. Nothing was stored. */
export class DeckError extends Error {
  constructor(
    readonly code: DeckErrorCode,
    message: string,
    readonly details: { currentVersion?: number; issues?: string[] } = {}
  ) {
    super(message);
    this.name = "DeckError";
  }
}
