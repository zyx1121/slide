import { applyPatch } from "fast-json-patch";
import { describe, expect, it } from "vitest";

import { retarget } from "../editor/retarget";
import { DeckError } from "./errors";
import { applyOperations, type Operation } from "./patch";
import { sampleDocument } from "./sample";
import type { DeckDocument } from "./schema";

function refusal(fn: () => unknown): DeckError {
  try {
    fn();
  } catch (error) {
    if (error instanceof DeckError) return error;
    throw error;
  }
  throw new Error("expected a DeckError");
}

describe("applyOperations", () => {
  it("applies operations and returns an inverse that restores the original", () => {
    const original = sampleDocument();
    const { document, inverse } = applyOperations(original, [
      { op: "replace", path: "/slides/0/shapes/0/fill", value: "#ff0000" },
      { op: "remove", path: "/slides/0/shapes/6" },
    ]);
    const shape = document.slides[0].shapes[0];
    expect(shape.kind === "roundRect" && shape.fill).toBe("#ff0000");
    expect(document.slides[0].shapes).toHaveLength(6);
    expect(applyPatch(structuredClone(document), inverse).newDocument).toEqual(
      original
    );
  });

  it("never modifies the document it is given", () => {
    const original = sampleDocument();
    const snapshot = structuredClone(original);
    applyOperations(original, [
      { op: "replace", path: "/title", value: "Renamed" },
    ]);
    expect(original).toEqual(snapshot);
  });

  it("refuses an empty patch and a path that does not exist", () => {
    expect(refusal(() => applyOperations(sampleDocument(), [])).code).toBe(
      "invalid_patch"
    );
    const missing = refusal(() =>
      applyOperations(sampleDocument(), [
        { op: "replace", path: "/slides/9/title", value: "x" },
      ])
    );
    expect(missing.code).toBe("invalid_patch");
    expect(missing.message).toMatch(/^operation 0 \(/);
  });

  it("honours test operations, so a writer can guard what it changes", () => {
    const failed = refusal(() =>
      applyOperations(sampleDocument(), [
        { op: "test", path: "/slides/0/title", value: "Something else" },
        { op: "replace", path: "/slides/0/title", value: "New" },
      ])
    );
    expect(failed.code).toBe("invalid_patch");
  });

  it("refuses a result that breaks the schema and lists every issue", () => {
    const broken = refusal(() =>
      applyOperations(sampleDocument(), [
        { op: "replace", path: "/slides/0/shapes/0/fill", value: "red" },
        { op: "remove", path: "/slides/0/shapes/1" },
      ])
    );
    expect(broken.code).toBe("invalid_document");
    expect(broken.details.issues).toEqual([
      "slides.0.shapes.0.fill: colors look like #3297fc, or #3297fc80 with alpha",
      "slides.0.shapes.2.end.shape: sh_asr is not a shape on this slide",
    ]);
  });

  it("refuses op names that are not RFC 6902 operations", () => {
    for (const op of [
      "toString",
      "constructor",
      "hasOwnProperty",
      "valueOf",
      "_get",
      "__proto__",
      "",
    ]) {
      const refused = refusal(() =>
        applyOperations(sampleDocument(), [
          { op, path: "/title", value: "x" } as never,
        ])
      );
      expect(refused.code).toBe("invalid_patch");
      expect(refused.message).toMatch(/^operation 0: op must be one of/);
    }
    for (const operation of [null, "replace", 42, []]) {
      expect(
        refusal(() => applyOperations(sampleDocument(), [operation])).code
      ).toBe("invalid_patch");
    }
  });

  it("refuses copy, which could double the document with every operation", () => {
    const doubling = Array.from({ length: 25 }, () => ({
      op: "copy",
      from: "/slides",
      path: "/slides/-",
    }));
    const refused = refusal(() =>
      applyOperations(sampleDocument(), doubling as never)
    );
    expect(refused.code).toBe("invalid_patch");
    expect(refused.message).toMatch(/^operation 0: op must be one of/);
  });

  it("refuses a patch that changes nothing", () => {
    for (const ops of [
      [{ op: "test", path: "/title", value: "Agent Sense" }],
      [{ op: "replace", path: "/title", value: "Agent Sense" }],
    ]) {
      const refused = refusal(() => applyOperations(sampleDocument(), ops));
      expect(refused.code).toBe("invalid_patch");
      expect(refused.message).toBe("the patch changes nothing");
    }
  });

  it("refuses prototype pollution paths", () => {
    expect(
      refusal(() =>
        applyOperations(sampleDocument(), [
          { op: "add", path: "/__proto__/polluted", value: true },
        ])
      ).code
    ).toBe("invalid_patch");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses any operation on the deck's master", () => {
    const doc = sampleDocument();
    for (const ops of [
      [{ op: "replace", path: "/master", value: doc.master }],
      [{ op: "replace", path: "/master/name", value: "Other" }],
      [{ op: "move", from: "/master/name", path: "/title" }],
      [{ op: "remove", path: "/master/shapes/0" }],
    ]) {
      expect(() => applyOperations(doc, ops)).toThrow(/keeps the master/);
    }
    expect(
      applyOperations(doc, [{ op: "add", path: "/slides/0/layout", value: 2 }])
        .document.slides[0].layout
    ).toBe(2);
  });

  describe("inverse", () => {
    const doc = sampleDocument();
    const shape = (document: DeckDocument, id: string) =>
      document.slides[0].shapes.find((found) => found.id === id)!;
    const note = { ...shape(doc, "tx_note"), id: "tx_more" };
    const twoSlides = applyOperations(doc, [
      {
        op: "add",
        path: "/slides/-",
        value: { id: "sl_two", title: "Two", shapes: [] },
      },
    ]).document;
    const withNotes = applyOperations(doc, [
      { op: "add", path: "/slides/0/notes", value: "Notes" },
    ]).document;
    /** A guarded inverse, re-pointed and applied as a revert applies it. */
    const revert = (document: DeckDocument, inverse: Operation[]) =>
      applyOperations(document, retarget(document, inverse), {
        overwrite: false,
        maxOperations: Infinity,
      }).document;

    const cases: [DeckDocument, Operation[]][] = [
      [
        doc,
        [
          {
            op: "add",
            path: "/slides/0/shapes/0",
            value: { ...note, id: "sh_new" },
          },
          { op: "remove", path: "/slides/0/shapes/6" },
          { op: "replace", path: "/slides/0/title", value: "Other" },
          { op: "add", path: "/slides/0/notes", value: "Notes" },
        ],
      ],
      [twoSlides, [{ op: "move", from: "/slides/1", path: "/slides/0" }]],
      [twoSlides, [{ op: "move", from: "/slides/0", path: "/slides/-" }]],
      [twoSlides, [{ op: "add", path: "/slides/1/layout", value: 2 }]],
      [doc, [{ op: "replace", path: "/slides/0/shapes/1/x", value: 10 }]],
      [doc, [{ op: "add", path: "/slides/0/shapes/01", value: note }]],
      [withNotes, [{ op: "remove", path: "/slides/0/notes" }]],
      [withNotes, [{ op: "add", path: "/slides/0/notes", value: "Other" }]],
      // An edit to what the same patch then removes.
      [
        doc,
        [
          { op: "replace", path: "/slides/0/shapes/6/x", value: 10 },
          { op: "remove", path: "/slides/0/shapes/6" },
        ],
      ],
      // An edit inside what the same patch added.
      [
        doc,
        [
          { op: "add", path: "/slides/0/shapes/-", value: note },
          {
            op: "add",
            path: "/slides/0/shapes/7/text/paragraphs/0/runs/-",
            value: { text: " (more)" },
          },
        ],
      ],
      // Inside a paragraph, which has no id.
      [
        doc,
        [
          {
            op: "replace",
            path: "/slides/0/shapes/5/text/paragraphs/0/runs/1/text",
            value: "ASR",
          },
        ],
      ],
    ];

    it("undoes each operation exactly, plain or guarded", () => {
      for (const [base, ops] of cases) {
        const sent = structuredClone(ops);
        const plain = applyOperations(base, ops);
        expect(applyOperations(plain.document, plain.inverse).document).toEqual(
          base
        );
        const guarded = applyOperations(base, ops, { guardInverse: true });
        expect(revert(guarded.document, guarded.inverse)).toEqual(base);
        // Applying never changes the operations it was given.
        expect(ops).toEqual(sent);
      }
    });

    it("leaves later edits to shapes that moved alone", () => {
      const inserted = applyOperations(
        doc,
        [
          {
            op: "add",
            path: "/slides/0/shapes/0",
            value: { ...note, id: "sh_new" },
          },
        ],
        { guardInverse: true }
      );
      // Later, a shape after it changes at its new place.
      const edited = applyOperations(inserted.document, [
        { op: "replace", path: "/slides/0/shapes/2/x", value: 999 },
      ]).document;
      const undone = revert(edited, inserted.inverse);
      expect(undone.slides[0].shapes.map((found) => found.id)).toEqual(
        doc.slides[0].shapes.map((found) => found.id)
      );
      expect(shape(undone, "sh_asr")).toMatchObject({ x: 999 });
    });

    it("reverts on the shape it changed, wherever it is now", () => {
      const red = applyOperations(
        doc,
        [{ op: "replace", path: "/slides/0/shapes/1/fill", value: "#ff0000" }],
        { guardInverse: true }
      );
      // Later, another shape gets the same fill, and one goes before both.
      const later = applyOperations(red.document, [
        { op: "replace", path: "/slides/0/shapes/2/fill", value: "#ff0000" },
        { op: "add", path: "/slides/0/shapes/0", value: note },
      ]).document;
      const reverted = revert(later, red.inverse);
      expect(shape(reverted, "sh_asr")).toMatchObject({
        fill: (shape(doc, "sh_asr") as { fill?: string }).fill,
      });
      expect(shape(reverted, "sh_router")).toMatchObject({ fill: "#ff0000" });
    });

    it("refuses when a later edit changed the same place", () => {
      const red = applyOperations(
        doc,
        [{ op: "replace", path: "/slides/0/shapes/1/fill", value: "#ff0000" }],
        { guardInverse: true }
      );
      const later = applyOperations(red.document, [
        { op: "replace", path: "/slides/0/shapes/1/fill", value: "#00ff00" },
      ]).document;
      expect(refusal(() => revert(later, red.inverse)).code).toBe(
        "invalid_patch"
      );
      // Notes cleared, then written again: putting the old back is refused.
      const cleared = applyOperations(
        withNotes,
        [{ op: "remove", path: "/slides/0/notes" }],
        { guardInverse: true }
      );
      const rewritten = applyOperations(cleared.document, [
        { op: "add", path: "/slides/0/notes", value: "New" },
      ]).document;
      expect(refusal(() => revert(rewritten, cleared.inverse)).message).toMatch(
        /is set already/
      );
      expect(revert(cleared.document, cleared.inverse)).toEqual(withNotes);
    });
  });

  it("refuses a patch on the whole document", () => {
    const doc = sampleDocument();
    expect(
      refusal(() =>
        applyOperations(doc, [{ op: "replace", path: "", value: doc }])
      ).message
    ).toMatch(/not the whole document/);
  });
});
