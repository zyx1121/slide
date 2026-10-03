import { describe, expect, it } from "vitest";

import { readColor } from "./color";
import type { El } from "./read";

const el = (tag: string, attrs: Record<string, string>, children: El[] = []) =>
  ({ tag, attrs, children, text: "" }) as El;

/** A fill of #4f81bd (Office's accent 1) with one change applied. */
const fill = (change?: El) =>
  el("a:solidFill", {}, [
    el("a:srgbClr", { val: "4F81BD" }, change ? [change] : []),
  ]);

describe("readColor", () => {
  it("tints in linear light, as PowerPoint draws its default table's bands", () => {
    // Medium Style 2 - Accent 1 in PowerPoint's PDF: #d0d7e8 and #e9edf3.
    expect(
      readColor(fill(el("a:tint", { val: "40000" })), new Map(), new Map())
    ).toBe("#d0d8e8");
    expect(
      readColor(fill(el("a:tint", { val: "20000" })), new Map(), new Map())
    ).toBe("#e9edf4");
  });

  it("shades toward black, keeping the color at 100%", () => {
    const shade = (val: string) =>
      readColor(fill(el("a:shade", { val })), new Map(), new Map());
    expect(shade("100000")).toBe("#4f81bd");
    expect(shade("0")).toBe("#000000");
    // Office 2007's default shape outline, accent 1 at shade 50%.
    expect(shade("50000")).toBe("#385d8a");
  });
});
