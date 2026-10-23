# slide verification map

Read this index before driving the app, then use the matching feature file.

## Baseline

- A stack from `up.sh`, healthy by `doctor.sh`.
- One member, `verify-member`, with no decks.
- A session cookie from `session.ts`.

## Conventions

- Find elements by role and accessible name. The UI copy is Traditional
  Chinese, so names such as `新增` and `重新命名「…」` are the handles.
- A journey that writes reads the result back from Postgres.
- Never weaken a journey to make it pass. A missing precondition fails the
  journey, and the reason goes in that feature's `Gotchas`.

## Features

| File                   | Feature                                         | Scripted          |
| ---------------------- | ----------------------------------------------- | ----------------- |
| [decks.md](decks.md)   | Make, rename and delete a deck on the home page | `drive-decks.mjs` |
| [export.md](export.md) | Download a deck as `.pptx`                      | `curl` recipe     |
| [editor.md](editor.md) | Draw and edit shapes on a slide                 | not yet           |
