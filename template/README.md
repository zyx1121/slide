# WinLab template

`winlab.pptx` is the WinLab slide master (the same file the `winlab-pptx` skill in zyx1121/plugin builds from). It belongs to WinLab, NYCU; the MIT license of this repository does not cover it or the logo inside it.

`public/template/winlab-background.png` is its content-slide background (gradient, logo, title rule, footer bar) without placeholders, at 3840 x 2160. Regenerate it after changing the master:

```sh
sh scripts/template-background.sh
```

Template geometry used by the renderer (px on the 1920 x 1080 canvas) lives in `lib/render/template.ts`.
