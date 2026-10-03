// Reading an uploaded .pptx safely: unzipping within limits and parsing
// its XML parts into a small element tree. The file is untrusted, so the
// zip's declared sizes are capped before anything is inflated, and XML
// with a document type (where entity expansion lives) is refused.
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

/** Limits for an uploaded file: its parts, one part, and all of them. */
export const MAX_PARTS = 5000;
export const MAX_PART_BYTES = 40 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 400 * 1024 * 1024;

export class PptxError extends Error {
  constructor(
    readonly code: "not-pptx" | "too-large" | "malformed",
    message: string
  ) {
    super(message);
  }
}

/**
 * The parts of a .pptx. fflate inflates each part into a buffer of its
 * declared size and never past it, so capping the declared sizes caps the
 * memory a zip bomb can take.
 */
export function unzipPptx(bytes: Uint8Array): Map<string, Uint8Array> {
  let count = 0;
  let total = 0;
  let tooLarge = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        count++;
        total += file.originalSize;
        if (
          count > MAX_PARTS ||
          file.originalSize > MAX_PART_BYTES ||
          total > MAX_TOTAL_BYTES
        ) {
          tooLarge = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new PptxError("not-pptx", "not a zip file");
  }
  if (tooLarge) throw new PptxError("too-large", "the file unpacks too large");
  if (!files["ppt/presentation.xml"]) {
    throw new PptxError("not-pptx", "no ppt/presentation.xml");
  }
  return new Map(Object.entries(files));
}

/** An XML element: its tag (with prefix), attributes, children and text. */
export type El = {
  tag: string;
  attrs: Record<string, string>;
  children: El[];
  text: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
});

type Raw = Record<string, unknown>;

function convert(raw: Raw[]): El[] {
  const out: El[] = [];
  for (const node of raw) {
    if ("#text" in node) {
      out.push({
        tag: "#text",
        attrs: {},
        children: [],
        text: String(node["#text"]),
      });
      continue;
    }
    const tag = Object.keys(node).find((key) => key !== ":@");
    if (!tag || tag.startsWith("?")) continue;
    const attrs = (node[":@"] as Record<string, string> | undefined) ?? {};
    out.push({
      tag,
      attrs: Object.fromEntries(
        Object.entries(attrs).map(([key, value]) => [key, String(value)])
      ),
      children: convert((node[tag] as Raw[]) ?? []),
      text: "",
    });
  }
  return out;
}

/** The root element of an XML part. */
export function parseXml(bytes: Uint8Array): El {
  const text = new TextDecoder().decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new PptxError("malformed", "XML with a document type");
  }
  let raw: Raw[];
  try {
    raw = parser.parse(text) as Raw[];
  } catch {
    throw new PptxError("malformed", "invalid XML");
  }
  const root = convert(raw).find((el) => el.tag !== "#text");
  if (!root) throw new PptxError("malformed", "empty XML part");
  return root;
}

/** The first child with a tag. */
export const child = (el: El | undefined, tag: string): El | undefined =>
  el?.children.find((c) => c.tag === tag);

/** Every child with a tag. */
export const children = (el: El | undefined, tag: string): El[] =>
  el?.children.filter((c) => c.tag === tag) ?? [];

/** A descendant along a path of tags. */
export function path(el: El | undefined, ...tags: string[]): El | undefined {
  let at = el;
  for (const tag of tags) at = child(at, tag);
  return at;
}

/** The text inside an element, all of it. */
export function textOf(el: El | undefined): string {
  if (!el) return "";
  if (el.tag === "#text") return el.text;
  return el.children.map(textOf).join("");
}

/** A number attribute, or undefined. */
export function num(el: El | undefined, name: string): number | undefined {
  const value = el?.attrs[name];
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** A part's relationships: id to target part name, resolved. */
export function relationships(
  parts: Map<string, Uint8Array>,
  partName: string
): Map<string, { target: string; type: string; external: boolean }> {
  const slash = partName.lastIndexOf("/");
  const dir = partName.slice(0, slash);
  const relsName = `${dir}/_rels/${partName.slice(slash + 1)}.rels`;
  const out = new Map<
    string,
    { target: string; type: string; external: boolean }
  >();
  const bytes = parts.get(relsName);
  if (!bytes) return out;
  for (const rel of children(parseXml(bytes), "Relationship")) {
    const id = rel.attrs.Id;
    const target = rel.attrs.Target ?? "";
    const external = rel.attrs.TargetMode === "External";
    if (!id) continue;
    out.set(id, {
      target: external ? target : resolvePath(dir, target),
      type: rel.attrs.Type ?? "",
      external,
    });
  }
  return out;
}

/** A relative part path resolved against a directory, without leaving the package. */
export function resolvePath(dir: string, target: string): string {
  const segments = target.startsWith("/") ? [] : dir.split("/").filter(Boolean);
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}
