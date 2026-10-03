// Freeform outlines: SVG path syntax limited to absolute M, L, C, Q and Z,
// with coordinates from 0 to 1000 across the shape's box, so the outline
// stretches with the box as DrawingML's custom geometry does.

export const PATH_UNITS = 1000;
export const PATH_MAX = 20_000;

export type PathCommand =
  | { op: "M" | "L"; points: [number, number][] }
  | { op: "C"; points: [number, number][] }
  | { op: "Q"; points: [number, number][] }
  | { op: "Z"; points: [] };

const ARITY = { M: 1, L: 1, C: 3, Q: 2, Z: 0 } as const;

/** The commands of a path, or null when it is not one this schema takes. */
export function parsePath(d: string): PathCommand[] | null {
  if (d.length > PATH_MAX) return null;
  const tokens = d.match(/[MLCQZ]|-?(?:\d+\.?\d*|\.\d+)|\S/g) ?? [];
  const commands: PathCommand[] = [];
  let i = 0;
  while (i < tokens.length) {
    const op = tokens[i++] as keyof typeof ARITY;
    if (!(op in ARITY)) return null;
    const values: number[] = [];
    while (i < tokens.length && !(tokens[i] in ARITY)) {
      const value = Number(tokens[i++]);
      if (!Number.isFinite(value) || value < 0 || value > PATH_UNITS) {
        return null;
      }
      values.push(value);
    }
    const count = ARITY[op] * 2;
    if (op === "Z") {
      if (values.length) return null;
      commands.push({ op, points: [] });
      continue;
    }
    if (values.length !== count) return null;
    const points: [number, number][] = [];
    for (let j = 0; j < values.length; j += 2) {
      points.push([values[j], values[j + 1]]);
    }
    commands.push({ op, points } as PathCommand);
  }
  // A path starts where it is put down.
  if (commands.length === 0 || commands[0].op !== "M") return null;
  return commands;
}

/** A path's commands as text, numbers rounded to hundredths. */
export function formatPath(commands: PathCommand[]): string {
  const n = (v: number) => String(Math.round(v * 100) / 100);
  return commands
    .map((c) => [c.op, ...c.points.flatMap(([x, y]) => [n(x), n(y)])].join(" "))
    .join(" ");
}
