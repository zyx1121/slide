# Built-in masters

Slide ships two slide masters. A deck carries its master in the document (`document.master`): its layouts, each with a background, artwork shapes, and title and slide number placeholders, read from the `.pptx` by the importer. `lib/master/builtin.json` holds the two as the document does; regenerate it after changing either file:

```sh
bun scripts/masters.ts
```

A test fails when the JSON and the files disagree. When the master files' sha256 change (a template changed, or how master files are cut), add the old ones to `RETIRED_FILES` in `lib/master/builtin-assets.ts`: decks keep the sha256 they were saved with. An export starts from the master file (the `.pptx` without its slides, `lib/pptx/master-file.ts`), so a deck exported on a built-in master opens in PowerPoint on that master, layouts included. The masters' pictures are served to anyone, as part of Slide.

## plain

`plain.pptx` is the default: a white slide, a black title, a gray slide number. It is `winlab.pptx` with the WinLab artwork taken out (the other layouts, the sample slides, every picture and drawn shape of the master, the gradient, the blue), so both share their placeholders and text styles. Regenerate it after changing `winlab.pptx`:

```sh
bun scripts/template-plain.ts
```

## winlab

`winlab.pptx` is the WinLab slide master (the same file the `winlab-pptx` skill in zyx1121/plugin builds from). It belongs to WinLab, NYCU; the MIT license of this repository does not cover it or the logo inside it. Its master sets a palette (`lib/editor/palette.ts`), which `check_deck` holds shapes to.
