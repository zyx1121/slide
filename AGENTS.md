<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## This repo

- Design and decisions live in [PLAN.md](PLAN.md). Work items are GitHub issues; one PR closes one issue.
- Stack: Next.js 16 (App Router, no `src/`), Tailwind v4, shadcn (base-nova), Postgres through `postgres` (postgres.js), bun.
- Schema changes are SQL files in `migrations/` named `NNNN_name.sql`, applied in name order by `scripts/migrate.ts`. Never edit a migration that has been applied; add a new one.
- Checks: `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test`. CI also builds the image and smoke-tests `docker compose up` with `scripts/smoke.sh`.
- GitHub text (issues, PRs, comments, docs) is English. UI copy is Traditional Chinese (zh-Hant).
