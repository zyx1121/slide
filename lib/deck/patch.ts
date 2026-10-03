import {
  applyPatch,
  compare,
  JsonPatchError,
  type Operation,
} from "fast-json-patch";

import { DeckError } from "./errors";
import { DeckDocument, describeIssues } from "./schema";

export type { Operation };

const MAX_OPERATIONS = 1000;
const MAX_DOCUMENT_BYTES = 5_000_000;

/**
 * Applies RFC 6902 operations to a copy of the document and validates the
 * result. Returns the new document and the inverse patch that turns it back.
 * Throws DeckError ("invalid_patch" or "invalid_document"); the input is never
 * modified.
 */
export function applyOperations(
  document: DeckDocument,
  operations: unknown
): { document: DeckDocument; operations: Operation[]; inverse: Operation[] } {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new DeckError(
      "invalid_patch",
      "a patch is a non-empty array of RFC 6902 operations"
    );
  }
  if (operations.length > MAX_OPERATIONS) {
    throw new DeckError(
      "invalid_patch",
      `a patch holds at most ${MAX_OPERATIONS} operations`
    );
  }

  let next: unknown;
  try {
    next = applyPatch(
      structuredClone(document),
      operations as Operation[],
      true, // validate every operation before applying it
      true, // mutate the clone in place
      true // refuse __proto__ and constructor paths
    ).newDocument;
  } catch (error) {
    // The clone is plain JSON, so anything applyPatch throws is the patch's
    // fault; a __proto__ path, for one, is a plain TypeError.
    const reason = error instanceof Error ? error.message.split("\n")[0] : "";
    if (error instanceof JsonPatchError) {
      throw new DeckError(
        "invalid_patch",
        `operation ${error.index ?? 0} (${error.name}): ${reason}`
      );
    }
    throw new DeckError("invalid_patch", reason || "the patch was refused");
  }

  if (JSON.stringify(next).length > MAX_DOCUMENT_BYTES) {
    throw new DeckError(
      "invalid_document",
      `a deck document is at most ${MAX_DOCUMENT_BYTES} bytes of JSON`
    );
  }
  const parsed = DeckDocument.safeParse(next);
  if (!parsed.success) {
    const issues = describeIssues(parsed.error);
    throw new DeckError(
      "invalid_document",
      `the patched document is not a valid deck: ${issues[0]}`,
      { issues }
    );
  }

  return {
    document: parsed.data,
    operations: operations as Operation[],
    inverse: compare(parsed.data, document),
  };
}
