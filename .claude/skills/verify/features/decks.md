# Decks on the home page

## Sub-features

- Make a deck from a master (`/new`, `createDeckAction`).
- Rename a deck in place on its card.
- Delete a deck; it moves to the recently deleted list.

## How to get to it (user POV)

Open the home page. Press `新增` in the top-right corner, pick a master, and
the editor opens. Back on the home page, each deck card has a pencil
(`重新命名「<title>」`) and a bin (`刪除「<title>」`).

## Driving it

```sh
COOKIE=$(bun $S/session.ts "$run") node $S/drive-decks.mjs "$run"
```

Steps and checks, in `log.txt` order:

1. `signed in`: the home page does not redirect to `/auth/`.
2. `deck row exists`: after `新增` and the first master, the URL is
   `/decks/<id>` and `decks` has that id for `verify-member`.
3. `title stored`: after renaming to `verify <run id>`, `decks.title` matches.
4. `deck marked deleted`: after the bin, `decks.deleted_at` is set.
5. `no page errors or 5xx`.

## Gotchas

- `decks.owner_sub` references `users`. A real sign-in writes the member in
  the OIDC callback; `up.sh` seeds it because `session.ts` skips that
  callback. Without the row, `/new` fails with a 500 and React error 441.
- Deleting has no confirmation step; one press of the bin deletes.
