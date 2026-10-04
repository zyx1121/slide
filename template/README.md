# Templates

A deck names its template (`template` in the document; plain when left out). `lib/render/template.ts` lists them with the geometry the renderer shares (px on the 1920 x 1080 canvas) and what each one changes: background, title and slide number colors, the `.pptx` an export starts from, and whether the rule check holds colors to the palette.

## plain

`plain.pptx` is the default: a white slide, a black title, a gray slide number. It is `winlab.pptx` with the WinLab artwork taken out (the other layouts, the sample slides, every picture and drawn shape of the master, the gradient, the blue), so both templates share their placeholders and text styles. Regenerate it after changing `winlab.pptx`:

```sh
bun scripts/template-plain.ts
```

## winlab

`winlab.pptx` is the WinLab slide master (the same file the `winlab-pptx` skill in zyx1121/plugin builds from). It belongs to WinLab, NYCU; the MIT license of this repository does not cover it or the logo inside it.

`public/template/winlab-background.png` is its content-slide background (gradient, logo, title rule, footer bar) without placeholders, at 3840 x 2160. Regenerate it after changing the master:

```sh
sh scripts/template-background.sh
```
