import { applyPatch } from "fast-json-patch";
import { describe, expect, it } from "vitest";

import { DeckError } from "./errors";
import { applyOperations, type Operation } from "./patch";
import { sampleDocument } from "./sample";

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

  it("builds an inverse that undoes each operation exactly", () => {
    const doc = sampleDocument();
    const patches: Operation[][] = [
      [
        {
          op: "add",
          path: "/slides/0/shapes/0",
          value: { ...doc.slides[0].shapes[0], id: "sh_new" },
        },
        { op: "remove", path: "/slides/0/shapes/6" },
        { op: "replace", path: "/slides/0/title", value: "Other" },
        { op: "add", path: "/slides/0/notes", value: "Notes" },
      ],
      [
        {
          op: "add",
          path: "/slides/-",
          value: { id: "sl_two", title: "Two", shapes: [] },
        },
        { op: "move", from: "/slides/1", path: "/slides/0" },
        { op: "add", path: "/slides/1/layout", value: 2 },
      ],
      [{ op: "replace", path: "/slides/0/shapes/1/x", value: 10 }],
    ];
    for (const ops of patches) {
      const { document, inverse } = applyOperations(doc, ops);
      expect(applyOperations(document, inverse).document).toEqual(doc);
    }
  });

  it("undoes an insertion without touching what moved", () => {
    const doc = sampleDocument();
    const inserted = applyOperations(doc, [
      {
        op: "add",
        path: "/slides/0/shapes/0",
        value: { ...doc.slides[0].shapes[0], id: "sh_new" },
      },
    ]);
    // Later, a shape after it changes at its new place.
    const edited = applyOperations(inserted.document, [
      { op: "replace", path: "/slides/0/shapes/2/x", value: 999 },
    ]).document;
    const undone = applyOperations(edited, inserted.inverse).document;
    expect(undone.slides[0].shapes.map((shape) => shape.id)).toEqual(
      doc.slides[0].shapes.map((shape) => shape.id)
    );
    expect(undone.slides[0].shapes[1]).toMatchObject({ x: 999 });
  });
});
