# Export to PowerPoint

## Sub-features

- Download the whole deck as `.pptx`, built from its master file.

## How to get to it (user POV)

Open a deck. The first tool in the bottom dock, `下載 PowerPoint`, downloads
the file.

## Driving it

The dock button is a link to `GET /api/decks/<id>/export`, so `curl` with the
session cookie drives the same path:

```sh
COOKIE=$(bun $S/session.ts "$run"); . "$run/state"
id=<a deck id owned by verify-member, such as one made by drive-decks.mjs before deleting>
mkdir -p "$run/evidence/export"
curl -fsS -b "slide_session=$COOKIE" -D "$run/evidence/export/headers.txt" \
  -o "$run/evidence/export/deck.pptx" "$URL/api/decks/$id/export"
unzip -l "$run/evidence/export/deck.pptx" | tee "$run/evidence/export/entries.txt"
```

Proof: `headers.txt` has status 200 and a `.pptx` content type, and
`entries.txt` lists `ppt/slides/slide1.xml`.

## Gotchas

- A deleted deck answers 404. Run this before the delete step, or make a
  second deck.
