// Drives the home page's deck journey as a member: make a deck from a master,
// rename it, delete it. After each step it reads the decks table, a second
// view that does not go through the page, and saves a screenshot and an ARIA
// snapshot to the run's evidence folder. Exits 1 on the first failed check.
//
//   COOKIE=$(bun .claude/skills/verify/scripts/session.ts "$run") \
//     node .claude/skills/verify/scripts/drive-decks.mjs "$run"
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const run = process.argv[2];
if (!run || !process.env.COOKIE) {
  throw new Error("usage: COOKIE=... drive-decks.mjs <run dir>");
}
const state = Object.fromEntries(
  readFileSync(`${run}/state`, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(/=(.*)/s).slice(0, 2))
);
const pw = createRequire(`${process.env.PW_DIR}/`)("playwright");
const evidence = `${run}/evidence/decks`;
execFileSync("mkdir", ["-p", evidence]);

const docker = (process.env.DOCKER ?? "docker").split(" ");
function sql(query) {
  return execFileSync(
    docker[0],
    [
      ...docker.slice(1),
      "compose",
      "-p",
      state.PROJECT,
      "-f",
      `${run}/compose.yaml`,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "slide",
      "-d",
      "slide",
      "-tAc",
      query,
    ],
    { encoding: "utf8" }
  ).trim();
}

const log = [];
function check(name, ok, detail = "") {
  log.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  console.log(log.at(-1));
  if (!ok) {
    writeFileSync(`${evidence}/log.txt`, log.join("\n") + "\n");
    process.exit(1);
  }
}

const browser = await pw.chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
await context.addCookies([
  { name: "slide_session", value: process.env.COOKIE, url: state.URL + "/" },
]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("response", (response) => {
  if (response.status() >= 500) {
    errors.push(`${response.status()} ${response.url()}`);
  }
});

async function proof(step) {
  await page.screenshot({ path: `${evidence}/${step}.png` });
  writeFileSync(
    `${evidence}/${step}.aria.yaml`,
    await page.locator("body").ariaSnapshot()
  );
}

try {
  // 1. Make a deck: 新增 in the top-right corner, then the first master.
  await page.goto(state.URL + "/");
  check("signed in", !page.url().includes("/auth/"), page.url());
  await page.getByRole("link", { name: "新增" }).click();
  await page.waitForURL(/\/new$/);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL(/\/decks\/[^/]+$/, { timeout: 20_000 });
  const id = new URL(page.url()).pathname.split("/").at(-1);
  await proof("1-created");
  check(
    "deck row exists",
    sql(
      `select count(*) from decks where id = '${id}' and owner_sub = 'verify-member'`
    ) === "1",
    id
  );

  // 2. Rename it on the home page.
  const title = `verify ${state.RUN_ID}`;
  await page.goto(state.URL + "/");
  await page
    .getByRole("button", { name: /^重新命名「/ })
    .first()
    .click();
  const input = page.getByRole("textbox").first();
  await input.fill(title);
  await input.press("Enter");
  await page.getByRole("link", { name: title }).waitFor({ timeout: 10_000 });
  await page.reload();
  await proof("2-renamed");
  check(
    "title stored",
    sql(`select title from decks where id = '${id}'`) === title,
    title
  );

  // 3. Delete it; it moves to the recently deleted list.
  await page.getByRole("button", { name: `刪除「${title}」` }).click();
  await page.getByRole("link", { name: title }).waitFor({
    state: "detached",
    timeout: 10_000,
  });
  await page.reload();
  await proof("3-deleted");
  check(
    "deck marked deleted",
    sql(`select deleted_at is not null from decks where id = '${id}'`) === "t"
  );
} catch (error) {
  // A step that never reached its check: keep what the page showed.
  await page.screenshot({ path: `${evidence}/failed.png` }).catch(() => {});
  check("journey finished", false, error.message.split("\n")[0]);
}

check("no page errors or 5xx", errors.length === 0, errors.join("; "));
writeFileSync(`${evidence}/log.txt`, log.join("\n") + "\n");
await browser.close();
