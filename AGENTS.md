<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## This repo

- Design and decisions live in [PLAN.md](PLAN.md). Work items are GitHub issues; one PR closes one issue.
- Stack: Next.js 16 (App Router, no `src/`), Tailwind v4, shadcn (base-nova), Postgres through `postgres` (postgres.js), bun.
- Schema changes are SQL files in `migrations/` named `NNNN_name.sql`, applied in name order by `scripts/migrate.ts`. Never edit a migration that has been applied; add a new one. The runner wraps each file in a transaction, so a file must not contain its own `BEGIN` or `COMMIT`.
- Decks: `lib/deck/schema.ts` defines the document, and `lib/deck/store.ts` (`mutateDeck`) is the only write path. Every query takes the member's `sub`; agents write suggestions.
- Tests that need Postgres use `lib/test-db.ts` and run only when `TEST_DATABASE_URL` is set (each gets its own schema, dropped afterwards). CI sets it.
- Checks: `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test`. CI also builds the image and smoke-tests `docker compose up` with `scripts/smoke.sh`.
- UI follows the ui.zyx.tw design contract (https://github.com/zyx1121/www.zyx.tw/blob/main/apps/ui/DESIGN.md) through the task-web shell: pages render inside `TaskShell` (`components/task-shell.tsx`, `corners.tsx`, `corner-tip.tsx`, `zyx-mark.tsx`, copied from the task-web starter), with page actions in the top-right corner. Only 24/16/14 px text (`text-2xl`, `text-sm`, `text-xs`), weights 400 and 500, theme tokens instead of colors. `components/ui/` is owned by the shadcn CLI; add primitives with `bunx shadcn@latest add`, never edit them.
- GitHub text (issues, PRs, comments, docs) is English. UI copy is Traditional Chinese (zh-Hant).
