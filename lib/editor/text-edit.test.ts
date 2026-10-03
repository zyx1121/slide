import { describe, expect, it } from "vitest";

import type { TextBody } from "../deck/schema";
import {
  deleteRange,
  paragraphAt,
  plainText,
  replaceRange,
  selectedStyles,
  step,
  styleAt,
  styleParagraphs,
  styleRange,
  wordAt,
} from "./text-edit";

const body = (...paragraphs: string[]): TextBody => ({
  paragraphs: paragraphs.map((text) => ({ runs: [{ text }] })),
});

describe("replaceRange", () => {
  it("types into a run in the style of the character before the caret", () => {
    const start: TextBody = {
      paragraphs: [{ runs: [{ text: "ab", bold: true }, { text: "cd" }] }],
    };
    const at = { p: 0, o: 2 };
    const { body: next, caret } = replaceRange(
      start,
      at,
      at,
      "X",
      styleAt(start, at)
    );
    expect(next.paragraphs[0].runs).toEqual([
      { text: "abX", bold: true },
      { text: "cd" },
    ]);
    expect(caret).toEqual({ p: 0, o: 3 });
  });

  it("splits a paragraph on a newline, both halves keeping its settings", () => {
    const start: TextBody = {
      paragraphs: [{ runs: [{ text: "onetwo" }], bullet: "bullet", level: 1 }],
    };
    const at = { p: 0, o: 3 };
    const { body: next, caret } = replaceRange(start, at, at, "\n", {});
    expect(next.paragraphs).toEqual([
      { runs: [{ text: "one" }], bullet: "bullet", level: 1 },
      { runs: [{ text: "two" }], bullet: "bullet", level: 1 },
    ]);
    expect(caret).toEqual({ p: 1, o: 0 });
  });

  it("keeps a newline inside the paragraph for the title", () => {
    const start = body("ab");
    const at = { p: 0, o: 1 };
    const { body: next } = replaceRange(start, at, at, "\n", {}, false);
    expect(next.paragraphs).toEqual([{ runs: [{ text: "a\nb" }] }]);
  });

  it("joins paragraphs when the range crosses them", () => {
    const { body: next, caret } = deleteRange(
      body("hello", "world"),
      { p: 0, o: 2 },
      { p: 1, o: 3 }
    );
    expect(next.paragraphs).toEqual([{ runs: [{ text: "held" }] }]);
    expect(caret).toEqual({ p: 0, o: 2 });
  });

  it("keeps an emptied paragraph's style for what is typed next", () => {
    const start: TextBody = {
      paragraphs: [{ runs: [{ text: "ab", size: 60 }] }],
    };
    const { body: next } = deleteRange(start, { p: 0, o: 0 }, { p: 0, o: 2 });
    expect(next.paragraphs[0].runs).toEqual([{ text: "", size: 60 }]);
    expect(styleAt(next, { p: 0, o: 0 })).toEqual({ size: 60 });
  });

  it("counts offsets in code points, so emoji and CJK stay whole", () => {
    const start = body("a😀語");
    const at = { p: 0, o: 2 };
    const { body: next } = replaceRange(start, at, at, "X", {});
    expect(next.paragraphs[0].runs[0].text).toBe("a😀X語");
  });
});

describe("step", () => {
  it("moves by grapheme, over a whole emoji sequence", () => {
    const text = body("a👍🏽b");
    expect(step(text, { p: 0, o: 1 }, 1, "char")).toEqual({ p: 0, o: 3 });
    expect(step(text, { p: 0, o: 3 }, -1, "char")).toEqual({ p: 0, o: 1 });
  });

  it("crosses into the neighboring paragraph at either end", () => {
    const text = body("ab", "cd");
    expect(step(text, { p: 0, o: 2 }, 1, "char")).toEqual({ p: 1, o: 0 });
    expect(step(text, { p: 1, o: 0 }, -1, "char")).toEqual({ p: 0, o: 2 });
    expect(step(text, { p: 0, o: 0 }, -1, "char")).toEqual({ p: 0, o: 0 });
  });

  it("moves by word, skipping spaces", () => {
    const text = body("speech  recognition test");
    expect(step(text, { p: 0, o: 0 }, 1, "word")).toEqual({ p: 0, o: 6 });
    expect(step(text, { p: 0, o: 6 }, 1, "word")).toEqual({ p: 0, o: 19 });
    expect(step(text, { p: 0, o: 19 }, -1, "word")).toEqual({ p: 0, o: 8 });
  });
});

describe("selection helpers", () => {
  it("selects the word under a double click", () => {
    expect(wordAt(body("hello world"), { p: 0, o: 8 })).toEqual({
      anchor: { p: 0, o: 6 },
      focus: { p: 0, o: 11 },
    });
  });

  it("selects the paragraph under a triple click", () => {
    expect(paragraphAt(body("a", "bcd"), { p: 1, o: 1 })).toEqual({
      anchor: { p: 1, o: 0 },
      focus: { p: 1, o: 3 },
    });
  });

  it("copies text with paragraphs and line breaks as newlines", () => {
    expect(
      plainText(body("ab\u000bc", "de"), { p: 0, o: 1 }, { p: 1, o: 1 })
    ).toBe("b\nc\nd");
  });
});

describe("styling part of a text", () => {
  it("styles only the selected characters", () => {
    const next = styleRange(
      body("abcd"),
      { p: 0, o: 1 },
      { p: 0, o: 3 },
      {
        bold: true,
      }
    );
    expect(next.paragraphs[0].runs).toEqual([
      { text: "a" },
      { text: "bc", bold: true },
      { text: "d" },
    ]);
    expect(
      selectedStyles(next, {
        anchor: { p: 0, o: 1 },
        focus: { p: 0, o: 3 },
      })
    ).toEqual([{ bold: true }, { bold: true }]);
  });

  it("sets paragraph settings on every selected paragraph", () => {
    const next = styleParagraphs(
      body("a", "b", "c"),
      { p: 1, o: 0 },
      { p: 2, o: 1 },
      (props) => ({ ...props, bullet: "number", level: 2 })
    );
    expect(next.paragraphs.map(({ bullet, level }) => [bullet, level])).toEqual(
      [
        [undefined, undefined],
        ["number", 2],
        ["number", 2],
      ]
    );
  });

  it("drops a bullet set to none and a level of zero", () => {
    const start: TextBody = {
      paragraphs: [{ runs: [{ text: "a" }], bullet: "bullet", level: 1 }],
    };
    const next = styleParagraphs(start, { p: 0, o: 0 }, { p: 0, o: 0 }, () => ({
      bullet: "none",
      level: 0,
    }));
    expect(next.paragraphs[0]).toEqual({ runs: [{ text: "a" }] });
  });
});
