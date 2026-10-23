---
name: verify
description: "Drive the real slide web app to prove a change works: start a throwaway Docker stack built from this checkout, sign in as a seeded member, use a feature in Chromium the way a member does, check the database, keep screenshots and ARIA snapshots, and tear it all down. Use before reporting a change done, or when reproducing a bug in the editor, the home page, export or public links."
---

# Verify slide

Proves behavior on a real stack: the image built from this checkout, Postgres,
the migrate job and the web app, all under one compose project and one port
for this run only. It never touches another stack on the host.

Run everything on a Linux host with Docker, Bun and Node 22 (Loki's sandbox),
from a copy of this checkout with `node_modules` installed:

```sh
rsync -a --delete --exclude .git --exclude node_modules --exclude .next --exclude .env ./ sandbox:work/slide-verify/
ssh sandbox
cd ~/work/slide-verify && bun install --frozen-lockfile
export PATH=$HOME/.bun/bin:$PATH DOCKER="sudo docker"
S=.claude/skills/verify/scripts
```

`DOCKER="sudo docker"` is for hosts where the user is not in the `docker`
group. Every script reads it.

## Launch

```sh
run=$(sh $S/up.sh)
```

- Builds `ghcr.io/zyx1121/slide:verify-<run id>` from the checkout, starts
  compose project `slide-verify-<run id>` on port 3460, and waits for
  `/api/health` to report `"db":"ok"`. A first build takes about a minute.
- Seeds the member `verify-member` (`verify@example.test`), the only address
  on `ALLOWED_EMAILS`.
- Prints the run folder: `~/work/verify/slide/<run id>/`. It holds `state`,
  the run's `.env` (random secrets, mode 600) and `evidence/`.
- Set `PORT` when 3460 is taken and `RUN_ID` to name the run.
- Sign-in through a real provider is out of scope: `OIDC_ISSUER` points at a
  closed port, and `session.ts` seals a session cookie instead.

## Doctor

```sh
sh $S/doctor.sh "$run"
```

Read-only. Checks that the web container runs this run's image, the migrate
job exited 0 and `/api/health` reaches Postgres. Run it before the first
drive and after any failed drive.

## Drive

```sh
export PW_DIR=$(sh $S/pw.sh)
COOKIE=$(bun $S/session.ts "$run") node $S/drive-decks.mjs "$run"
```

- `pw.sh` installs the pinned Playwright and Chromium once, outside the
  checkout.
- `session.ts` seals the cookie with the run's `SESSION_SECRET` through the
  app's own `sealSession`. Over plain http the cookie is `slide_session`.
- Each feature's recipe is in [features/](features/README.md). Start with the
  index.

## Evidence

- Each drive writes to `$run/evidence/<feature>/`: a screenshot and an ARIA
  snapshot per step, `log.txt` with every check, and `failed.png` when a
  step dies before its check.
- Checks read the `decks` table through `psql` in the run's Postgres
  container: a second view that does not go through the page.
- Cite the evidence folder and the `log.txt` lines in the done report.

## Cleanup

```sh
sh $S/down.sh "$run"
```

Removes the compose project with its volumes, the image tag, the `.env` and
the compose file. Keeps `$run/evidence/`. Run it after every failed attempt
too, so no container or port is left behind.
