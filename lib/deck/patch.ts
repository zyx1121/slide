import {
  applyOperation,
  compare,
  JsonPatchError,
  type Operation,
} from "fast-json-patch";

import { guard } from "../editor/guard";
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

export type ApplyOptions = {
  /** At most this many operations; 5000 for a member's or an agent's patch. */
  maxOperations?: number;
  /**
   * Whether an add or a move may set an object member that is there
   * already. A revert's may not: what it puts back was gone after the edit,
   * so a member there now was set by a later edit, which it would undo.
   */
  overwrite?: boolean;
  /**
   * An inverse kept for a revert long after: pinned to the ids of the slides
   * and shapes it addresses (guard.ts), for retarget.ts to find them wherever
   * they are by then, and testing that each place it changes still holds
   * what the patch left there.
   */
  guardInverse?: boolean;
};

/**
 * Applies RFC 6902 operations to a copy of the document and validates the
 * result. Returns the new document and the inverse patch that turns it back,
 * built operation by operation, so it touches only what the patch touched.
 * Throws DeckError ("invalid_patch" or "invalid_document"), also for a patch
 * that changes nothing; neither the document nor the operations are modified.
 */
export function applyOperations(
  document: DeckDocument,
  operations: unknown,
  options: ApplyOptions = {}
): { document: DeckDocument; operations: Operation[]; inverse: Operation[] } {
  const {
    maxOperations = MAX_OPERATIONS,
    overwrite = true,
    guardInverse = false,
  } = options;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new DeckError(
      "invalid_patch",
      "a patch is a non-empty array of RFC 6902 operations"
    );
  }
  if (operations.length > maxOperations) {
    throw new DeckError(
      "invalid_patch",
      `a patch holds at most ${maxOperations} operations`
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
    const { path, from } = operation as { path?: unknown; from?: unknown };
    // A patch changes parts of the deck, never the whole of it at once.
    if (path === "" || from === "") {
      throw new DeckError(
        "invalid_patch",
        `operation ${index}: a patch changes parts of the deck, not the whole document`
      );
    }
    // A deck keeps the master it was made on; slides pick its layouts.
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

  const state = structuredClone(document) as unknown;
  const steps: Step[] = [];
  (operations as Operation[]).forEach((op, index) => {
    if (!overwrite && (op.op === "add" || op.op === "move")) {
      const place = locate(state, op.path);
      if (place && !Array.isArray(place.parent) && place.exists) {
        throw new DeckError(
          "invalid_patch",
          `operation ${index}: ${op.path} is set already`
        );
      }
    }
    try {
      steps.push(applyStep(state, op));
    } catch (error) {
      // The copy is plain JSON, so anything applying throws is the patch's
      // fault; a __proto__ path, for one, is a plain TypeError.
      const reason = error instanceof Error ? error.message.split("\n")[0] : "";
      if (error instanceof JsonPatchError) {
        throw new DeckError(
          "invalid_patch",
          `operation ${index} (${error.name}): ${reason}`
        );
      }
      throw new DeckError("invalid_patch", reason || "the patch was refused");
    }
  });

  if (JSON.stringify(state).length > MAX_DOCUMENT_BYTES) {
    throw new DeckError(
      "invalid_document",
      `a deck document is at most ${MAX_DOCUMENT_BYTES} bytes of JSON`
    );
  }
  const parsed = DeckDocument.safeParse(state);
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
    inverse: guardInverse
      ? guardedInverse(parsed.data, steps)
      : [...steps].reverse().flatMap((step) => step.undo),
  };
}

type Step = {
  /** Undoes the operation, on the document as the operation left it. */
  undo: Operation[];
  /** Tests, on that document, of what the undo is about to change. */
  checks: Operation[];
  /** Elements without an id the undo goes into or moves (see `mark`). */
  marks: Mark[];
};

/**
 * The inverse with its checks, pinned by guard.ts, whose walk through it
 * also proves each test holds where a revert meets it. Only a patch that
 * nests a list element in another and takes it out again can fail that (an
 * element changed after its last mark); it is refused, as no revert of it
 * could be checked.
 */
function guardedInverse(document: DeckDocument, steps: Step[]): Operation[] {
  try {
    return guard(document, checkedInverse(steps));
  } catch {
    throw new DeckError(
      "invalid_patch",
      "the patch moves list elements in a way its revert could not check"
    );
  }
}

/**
 * The inverse with its checks, last operation first. An element without an
 * id is tested once, where a revert first meets it: at the last operation
 * that went into it, with what it holds after the whole patch, since no
 * operation changed it after that one. From that test on, the revert's own
 * operations are all that change it or move it, so it needs no other test,
 * and the stored inverse grows with the patch, not with the operations
 * times the element.
 */
function checkedInverse(steps: Step[]): Operation[] {
  const last = new Map<object, number>();
  steps.forEach((step, k) => {
    for (const { element } of step.marks) last.set(element, k);
  });
  const checked: Operation[] = [];
  for (let k = steps.length - 1; k >= 0; k--) {
    const { undo, checks, marks } = steps[k];
    for (const { element, path } of marks) {
      if (last.get(element) !== k) continue;
      last.delete(element);
      checked.push({ op: "test", path, value: structuredClone(element) });
    }
    checked.push(...checks, ...undo);
  }
  return checked;
}

type Place = {
  /** The list or the object the path ends in. */
  parent: unknown[] | Record<string, unknown>;
  /** The member: an index into the list (its length for "-"), or a key. */
  key: number | string;
  /** The path, with its indices as numbers. */
  path: string;
  /** Whether the member is there; an object's inherited names are not. */
  exists: boolean;
};

const unescape = (token: string) =>
  token.replace(/~1/g, "/").replace(/~0/g, "~");
const escape = (token: string) =>
  token.replace(/~/g, "~0").replace(/\//g, "~1");

/** An index into a list as fast-json-patch reads one, or null. */
const indexOf = (list: unknown[], token: string) =>
  token === "-" ? list.length : /^\d*$/.test(token) ? ~~token : null;

const valueAt = (place: Place) =>
  (place.parent as Record<string | number, unknown>)[place.key];

const hasId = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { id?: unknown }).id === "string";

/** Where a JSON pointer ends in the document, or null when nowhere. */
function locate(root: unknown, pointer: string): Place | null {
  const tokens = pointer.split("/").slice(1).map(unescape);
  let node = root;
  let path = "";
  for (const [i, token] of tokens.entries()) {
    if (typeof node !== "object" || node === null) return null;
    const key = Array.isArray(node) ? indexOf(node, token) : token;
    if (key === null) return null;
    path += `/${escape(String(key))}`;
    const exists = Array.isArray(node)
      ? (key as number) < node.length
      : Object.hasOwn(node, key);
    if (i === tokens.length - 1) {
      return { parent: node as Place["parent"], key, path, exists };
    }
    if (!exists) return null;
    node = (node as Record<string | number, unknown>)[key];
  }
  return null;
}

/** Where an add or a move put its value: "-" is the end of the list. */
function landing(state: unknown, pointer: string): Place | null {
  const place = locate(state, pointer);
  if (!place || !Array.isArray(place.parent) || !pointer.endsWith("/-")) {
    return place;
  }
  const key = place.parent.length - 1;
  return {
    ...place,
    key,
    path: place.path.replace(/\/\d+$/, `/${key}`),
    exists: true,
  };
}

/** What a path names in the document, if anything. */
function elementAt(state: unknown, pointer: string): unknown {
  const place = locate(state, pointer);
  return place?.exists ? valueAt(place) : undefined;
}

type Mark = {
  /** The element, as the document holds it: its identity and its value. */
  element: object;
  /** Where it is, on the document the operation left. */
  path: string;
};

/**
 * The outermost list element above a path that has no id, such as a
 * paragraph: a later edit can shift it, and only its value tells it apart,
 * so a revert tests it. Slides and shapes are pinned by their ids instead
 * (guard.ts). Every operation that changes such an element goes through
 * it, so each one marks it.
 */
function mark(state: unknown, pointer: string): Mark[] {
  let node = state;
  let path = "";
  for (const token of pointer.split("/").slice(1, -1).map(unescape)) {
    if (typeof node !== "object" || node === null) return [];
    if (Array.isArray(node)) {
      const at = indexOf(node, token);
      if (at === null || at >= node.length) return [];
      path += `/${at}`;
      node = node[at];
      if (!hasId(node)) {
        return typeof node === "object" && node !== null
          ? [{ element: node, path }]
          : [];
      }
    } else {
      if (!Object.hasOwn(node, token)) return [];
      path += `/${escape(token)}`;
      node = (node as Record<string, unknown>)[token];
    }
  }
  return [];
}

/**
 * Applies one operation to the document in place, and returns what undoes
 * it: an add's removes what it added (or restores the member it wrote
 * over), a remove's puts the value back, a replace's restores it, a move's
 * moves it back. Its checks test, on the document the operation left, that
 * each place the undo changes still holds what the operation left there:
 * the value it set, or the whole of what it added. What a move moved is
 * the slide or shape its id names, or else the element it is (or is in).
 */
function applyStep(state: unknown, op: Operation): Step {
  if (op.op === "test") {
    applyOperation(state, op, true, true, true);
    return { undo: [], checks: [], marks: [] };
  }
  const target = locate(state, op.path);
  const source = op.op === "move" ? locate(state, op.from) : null;
  // The element without an id a move takes something out of, if any.
  const left = op.op === "move" ? mark(state, op.from) : [];
  // What the operation takes away or writes over, as it was.
  const old = target?.exists ? structuredClone(valueAt(target)) : undefined;
  // A copy, so a later operation writing into a value added here leaves
  // the patch as it was.
  applyOperation(state, structuredClone(op), true, true, true);
  // fast-json-patch also takes a name an object inherits, such as
  // "constructor", for a member there.
  if (
    !target ||
    ((op.op === "remove" || op.op === "replace") && !target.exists) ||
    (op.op === "move" && !source?.exists)
  ) {
    throw new Error(`${op.path} is not a part of the deck`);
  }

  switch (op.op) {
    case "add": {
      const at = landing(state, op.path)!;
      return {
        undo: [
          Array.isArray(at.parent) || !target.exists
            ? { op: "remove", path: at.path }
            : { op: "replace", path: at.path, value: old },
        ],
        checks: [
          { op: "test", path: at.path, value: structuredClone(valueAt(at)) },
        ],
        marks: mark(state, at.path),
      };
    }
    case "remove":
      return {
        undo: [{ op: "add", path: target.path, value: old }],
        checks: [],
        marks: mark(state, target.path),
      };
    case "replace":
      return {
        undo: [{ op: "replace", path: target.path, value: old }],
        checks: [
          {
            op: "test",
            path: target.path,
            value: structuredClone(valueAt(target)),
          },
        ],
        marks: mark(state, target.path),
      };
    case "move": {
      const at = landing(state, op.path)!;
      const undo: Operation[] = [
        { op: "move", from: at.path, path: source!.path },
      ];
      // A move onto an object member wrote over what it held.
      if (!Array.isArray(at.parent) && target.exists) {
        undo.push({ op: "add", path: at.path, value: old });
      }
      // It stays where it was, so a revert can test it there; only a patch
      // with a list in an odd shape midway could shift it.
      if (
        left.some(({ element, path }) => elementAt(state, path) !== element)
      ) {
        throw new Error(`${op.from}: the move shifts what it takes it out of`);
      }
      const moved = valueAt(at);
      const marks = [...mark(state, at.path), ...left];
      // Inside an element without an id, what moved is tested with it.
      if (marks.length > 0 || hasId(moved)) return { undo, checks: [], marks };
      if (typeof moved === "object" && moved !== null) {
        return { undo, checks: [], marks: [{ element: moved, path: at.path }] };
      }
      return {
        undo,
        checks: [{ op: "test", path: at.path, value: moved as never }],
        marks: [],
      };
    }
    default:
      return { undo: [], checks: [], marks: [] };
  }
}
