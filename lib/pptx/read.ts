// Reading an uploaded .pptx safely: unzipping within limits (unzip.ts
// holds every entry to its declared size) and parsing its XML parts into a
// small element tree. XML with a document type (where entity expansion
// lives) is refused, and a part's size and element count are capped, so a
// small upload cannot unfold into gigabytes of objects.
import { XMLParser } from "fast-xml-parser";

import { unzip, ZipError } from "./unzip";

/** Limits for an uploaded file: its parts, one part, and all of them. */
export const MAX_PARTS = 5000;
export const MAX_PART_BYTES = 40 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** Limits for one XML part: its size and its elements. */
export const MAX_XML_BYTES = 8 * 1024 * 1024;
export const MAX_XML_ELEMENTS = 200_000;

export class PptxError extends Error {
  constructor(
    readonly code: "not-pptx" | "too-large" | "malformed",
    message: string
  ) {
    super(message);
  }
}

/** The parts of a .pptx the importer reads. */
export function unzipPptx(bytes: Uint8Array): Map<string, Uint8Array> {
  let parts: Map<string, Uint8Array>;
  try {
    parts = unzip(
      bytes,
      {
        entries: MAX_PARTS,
        entryBytes: MAX_PART_BYTES,
        totalBytes: MAX_TOTAL_BYTES,
      },
      (name) =>
        name === "docProps/core.xml" ||
        (name.startsWith("ppt/") && !name.startsWith("ppt/notesSlides/"))
    );
  } catch (error) {
    if (!(error instanceof ZipError)) throw error;
    throw new PptxError(
      error.code === "not-zip" ? "not-pptx" : error.code,
      error.message
    );
  }
  if (!parts.has("ppt/presentation.xml")) {
    throw new PptxError("not-pptx", "no ppt/presentation.xml");
  }
  return parts;
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
  if (bytes.length > MAX_XML_BYTES) {
    throw new PptxError("too-large", "an XML part is too large");
  }
  let elements = 0;
  for (const byte of bytes)
    if (byte === 0x3c && ++elements > MAX_XML_ELEMENTS) {
      throw new PptxError("too-large", "an XML part has too many elements");
    }
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
