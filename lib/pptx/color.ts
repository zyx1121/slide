// DrawingML colors as #rrggbb(aa): sRGB values, system colors, and theme
// colors through the master's color map, with the luminance, tint, shade
// and alpha changes PowerPoint writes for theme variants.
import { child, type El } from "./read";

export type Theme = Map<string, string>;

/** The theme's twelve colors, by scheme name (dk1, lt1, accent1, ...). */
export function readTheme(theme: El | undefined): Theme {
  const scheme = child(child(theme, "a:themeElements"), "a:clrScheme");
  const colors: Theme = new Map();
  for (const el of scheme?.children ?? []) {
    if (el.tag === "#text") continue;
    const name = el.tag.replace(/^a:/, "");
    const value =
      child(el, "a:srgbClr")?.attrs.val ?? child(el, "a:sysClr")?.attrs.lastClr;
    if (value && /^[0-9a-f]{6}$/i.test(value)) {
      colors.set(name, `#${value.toLowerCase()}`);
    }
  }
  return colors;
}

/** The master's color map: bg1 to lt1, tx1 to dk1, and so on. */
export function readColorMap(clrMap: El | undefined): Map<string, string> {
  const map = new Map<string, string>([
    ["bg1", "lt1"],
    ["tx1", "dk1"],
    ["bg2", "lt2"],
    ["tx2", "dk2"],
  ]);
  for (const [key, value] of Object.entries(clrMap?.attrs ?? {})) {
    map.set(key, value);
  }
  return map;
}

const SYSTEM: Record<string, string> = {
  windowText: "#000000",
  window: "#ffffff",
};

function toHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r = l;
  let g = l;
  let b = l;
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const hex = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (l: number) =>
  Math.round(
    255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055)
  );

/**
 * A color moved `amount` of the way to white (1) or black (0) in linear
 * light, as PowerPoint applies tint and shade: its default table style's
 * 40% tint of #4f81bd is #d0d8e8 in its PDF, where mixing in sRGB gives
 * #b9cde5.
 */
function mix(hex: string, toward: 0 | 1, amount: number): string {
  const channel = (i: number) => {
    const l = toLinear(parseInt(hex.slice(i, i + 2), 16));
    return toSrgb(l + (toward - l) * amount);
  };
  return `#${[1, 3, 5].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The color an element such as <a:solidFill> holds, or undefined. `placeholder`
 * stands for phClr, the color a style reference passes in.
 */
export function readColor(
  holder: El | undefined,
  theme: Theme,
  colorMap: Map<string, string>,
  placeholder?: string
): string | undefined {
  const el = holder?.children.find((c) =>
    ["a:srgbClr", "a:schemeClr", "a:sysClr", "a:prstClr"].includes(c.tag)
  );
  if (!el) return undefined;
  let base: string | undefined;
  if (el.tag === "a:srgbClr") {
    const val = el.attrs.val ?? "";
    base = /^[0-9a-f]{6}$/i.test(val) ? `#${val.toLowerCase()}` : undefined;
  } else if (el.tag === "a:sysClr") {
    const last = el.attrs.lastClr;
    base =
      last && /^[0-9a-f]{6}$/i.test(last)
        ? `#${last.toLowerCase()}`
        : Object.hasOwn(SYSTEM, el.attrs.val ?? "")
          ? SYSTEM[el.attrs.val!]
          : undefined;
  } else if (el.tag === "a:prstClr") {
    base = el.attrs.val === "white" ? "#ffffff" : "#000000";
  } else {
    const name = el.attrs.val ?? "";
    base =
      name === "phClr"
        ? placeholder
        : (theme.get(colorMap.get(name) ?? name) ?? theme.get(name));
  }
  if (!base) return undefined;

  let color = base;
  let alpha: number | undefined;
  for (const change of el.children) {
    const val = Number(change.attrs.val) / 100000;
    if (!Number.isFinite(val)) continue;
    switch (change.tag) {
      case "a:lumMod":
      case "a:lumOff": {
        const [h, s, l] = toHsl(color);
        color = fromHsl(h, s, change.tag === "a:lumMod" ? l * val : l + val);
        break;
      }
      case "a:tint":
        color = mix(color, 1, 1 - val);
        break;
      case "a:shade":
        color = mix(color, 0, 1 - val);
        break;
      case "a:alpha":
        alpha = val;
        break;
    }
  }
  if (alpha !== undefined && alpha < 1) {
    const a = Math.round(Math.max(0, alpha) * 255)
      .toString(16)
      .padStart(2, "0");
    return `${color}${a}`;
  }
  return color;
}
