# Editor

Not scripted yet. Add a `drive-editor.mjs` the first time a change touches
the editor, and record what it checks here.

## Sub-features

- Insert shapes from the dock: rectangle, rounded rectangle (`插入圓角矩形`),
  ellipse, text, image, connector.
- Edit text in place; the save happens 800 ms after typing stops.
- Undo and redo; slide menu (`投影片`), layout (`版面`), notes, comments
  (`評論選取的物件`), history, play (`播放（⌘ Enter）`) and presenter mode.

## How to get to it (user POV)

Open a deck from the home page. Slides stack top to bottom; the dock sits at
the bottom center and changes its middle tools with the selection.

## Driving it

Source entry points: `components/editor/editor.tsx` (dock and saves),
`components/editor/dock-tools.tsx` (tool buttons, named by `tip`),
`components/editor/canvas.tsx` (pointer input).

Proof for a scripted run: after an edit, `decks.version` rises and
`decks.document` holds the new shape id.

## Gotchas

- Chromium's `PointerEvent.detail` is always 0; the editor counts double and
  triple clicks itself, so a test must send separate clicks.
- Text input goes through a hidden textarea; type into it, not into the SVG.
