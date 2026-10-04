import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { NOT_MEMBER_ACTIONS, PARITY } from "./parity";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function routes(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return routes(path);
    if (name !== "route.ts") return [];
    const route = `/${relative("app", dir)}`;
    return [
      ...read(path).matchAll(
        /export\s+(?:async\s+function|function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g
      ),
    ].map((match) => `${match[1]} ${route}`);
  });
}

/** Every file under app/ that starts with "use server". */
function serverActionFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) {
      return serverActionFiles(path);
    }
    if (!/\.tsx?$/.test(name)) return [];
    return /^\s*["']use server["']/.test(read(path)) ? [path] : [];
  });
}

describe("MCP parity with the web app", () => {
  const tools = new Set(
    [
      ...read("lib/mcp/server.ts").matchAll(/registerTool\(\s*"([a-z_]+)"/g),
    ].map((match) => match[1])
  );
  const actions = serverActionFiles("app").flatMap((path) =>
    [
      ...read(path).matchAll(/export\s+(?:async\s+function|const)\s+(\w+)\b/g),
    ].map((match) => match[1])
  );
  const apis = routes("app/api").filter(
    (route) => !NOT_MEMBER_ACTIONS.includes(route)
  );

  it("maps every server action and API route to a tool", () => {
    expect([...actions, ...apis].sort()).toEqual(Object.keys(PARITY).sort());
  });

  it("names only tools the server registers", () => {
    for (const [action, names] of Object.entries(PARITY)) {
      for (const name of names) {
        expect(tools.has(name), `${action} → ${name}`).toBe(true);
      }
    }
  });
});
