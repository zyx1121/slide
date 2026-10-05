import {
  applyOperation,
  applyPatch,
  compare,
  JsonPatchError,
  type Operation,
} from "fast-json-patch";

import { DeckError } from "./errors";
import { DeckDocument, describeIssues } from "./schema";

export type { Operation };

// Room for an edit plus the test operations that guard it (lib/editor/guard.ts).
const MAX_OPERATIONS = 5000;
const MAX_DOCUMENT_BYTES = 5_000_000;

// RFC 6902 operations, without copy. fast-json-patch looks `op` up on a plain
// object, so a name such as "toString" or its internal "_get" would otherwise
// slip through and return no document instead of throwing. Copy is left out
// because each copy can double the document before its size is checked: a
// few dozen bytes of patch would exhaust the server's memory. Without it, a
// patch can only grow the document by the values it carries.
const OPERATIONS = new Set(["add", "remove", "replace", "move", "test"]);

/**
 * Applies RFC 6902 operations to a copy of the document and validates the
 * result. Returns the new document and the inverse patch that turns it back.
 * Throws DeckError ("invalid_patch" or "invalid_document"), also for a patch
 * that changes nothing; the input is never modified.
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
  operations.forEach((operation: unknown, index) => {
    const op =
      typeof operation === "object" && operation !== null
        ? (operation as { op?: unknown }).op
        : undefined;
    if (typeof op !== "string" || !OPERATIONS.has(op)) {
      throw new DeckError(
        "invalid_patch",
        `operation ${index}: op must be one of ${[...OPERATIONS].join(", ")}`
      );
    }
    // A deck keeps the master it was made on; slides pick its layouts.
    const { path, from } = operation as { path?: unknown; from?: unknown };
    if (
      [path, from].some(
        (p) =>
          p === "/master" || (typeof p === "string" && p.startsWith("/master/"))
      )
    ) {
      throw new DeckError(
        "invalid_patch",
        `operation ${index}: a deck keeps the master it was made on`
      );
    }
  });

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

  if (typeof next !== "object" || next === null) {
    throw new DeckError("invalid_patch", "the patch left no document");
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

  if (compare(parsed.data, document).length === 0) {
    // A write that changes nothing would only add an empty revision.
    throw new DeckError("invalid_patch", "the patch changes nothing");
  }
  return {
    document: parsed.data,
    operations: operations as Operation[],
    inverse: guarded(
      parsed.data,
      inverseOf(document, operations as Operation[])
    ),
  };
}

/** A JSON pointer's reference tokens, unescaped. */
const tokens = (pointer: string) =>
  pointer
    .split("/")
    .slice(1)
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));

/** A reference token escaped for a JSON pointer. */
const escape = (token: string) =>
  token.replace(/~/g, "~0").replace(/\//g, "~1");

/** The container a pointer's last token is in, and that token. */
function locate(root: unknown, pointer: string) {
  const path = tokens(pointer);
  const key = path.pop()!;
  let parent = root as Record<string, unknown>;
  for (const token of path) parent = parent[token] as Record<string, unknown>;
  return {
    parent,
    key,
    at: `/${path.map(escape).join("/")}`.replace(/^\/$/, ""),
  };
}

const read = (root: unknown, pointer: string) => {
  const { parent, key } = locate(root, pointer);
  return structuredClone(parent[key]);
};

/**
 * The patch that undoes `operations`, built one operation at a time from
 * the document as it stood before each: an add's removes the same element
 * (or restores what an object key held), a remove's puts the old value
 * back, a replace's restores it, a move's moves back. Applied in reverse,
 * they undo the patch and touch nothing else: a revert later leaves the
 * edits made since to other elements alone, however their positions moved.
 */
function inverseOf(
  document: DeckDocument,
  operations: Operation[]
): Operation[] {
  const state = structuredClone(document) as unknown;
  const undo: Operation[][] = [];
  for (const op of operations) {
    switch (op.op) {
      case "add": {
        const { parent, key, at } = locate(state, op.path);
        if (Array.isArray(parent)) {
          const index = key === "-" ? parent.length : Number(key);
          undo.push([{ op: "remove", path: `${at}/${index}` }]);
        } else if (Object.hasOwn(parent, key)) {
          undo.push([
            { op: "replace", path: op.path, value: read(state, op.path) },
          ]);
        } else {
          undo.push([{ op: "remove", path: op.path }]);
        }
        break;
      }
      case "remove":
        undo.push([{ op: "add", path: op.path, value: read(state, op.path) }]);
        break;
      case "replace":
        undo.push([
          { op: "replace", path: op.path, value: read(state, op.path) },
        ]);
        break;
      case "move": {
        const { parent, key } = locate(state, op.path);
        const back: Operation[] = [
          { op: "move", from: op.path, path: op.from },
        ];
        // A move onto an object key overwrites what it held.
        if (!Array.isArray(parent) && Object.hasOwn(parent, key)) {
          back.push({ op: "add", path: op.path, value: read(state, op.path) });
        }
        undo.push(back);
        break;
      }
      default:
        break;
    }
    applyOperation(state, op, false, true, true);
  }
  return undo.reverse().flat();
}

/**
 * An inverse that checks before it acts: each replace, remove and move is
 * preceded by a test that the place still holds what the patch left there.
 * Applied later, it refuses when a later edit changed one of those places
 * (or moved what was there), and leaves every other place alone.
 */
function guarded(after: DeckDocument, inverse: Operation[]): Operation[] {
  const state = structuredClone(after) as unknown;
  const out: Operation[] = [];
  for (const op of inverse) {
    if (op.op === "replace" || op.op === "remove") {
      out.push({ op: "test", path: op.path, value: read(state, op.path) });
    } else if (op.op === "move") {
      out.push({ op: "test", path: op.from, value: read(state, op.from) });
    }
    out.push(op);
    applyOperation(state, op, false, true, true);
  }
  return out;
}
