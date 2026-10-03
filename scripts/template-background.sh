#!/bin/sh
# Regenerates public/template/winlab-background.png from template/winlab.pptx:
# the master's background, logo, title rule and footer bar, without the
# placeholders, at 2x (3840 x 2160). Needs uv, LibreOffice and poppler-utils.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
uv run -q --with python-pptx python3 - "$root/template/winlab.pptx" "$work/background.pptx" <<'PY'
import sys

from pptx import Presentation

src, dst = sys.argv[1], sys.argv[2]
deck = Presentation(src)
ids = deck.slides._sldIdLst
for sid in list(ids):
    deck.part.drop_rel(sid.rId)
    ids.remove(sid)
layout = next(
    l for l in deck.slide_masters[0].slide_layouts if l.name == "Title & Bullets"
)
slide = deck.slides.add_slide(layout)
for placeholder in list(slide.placeholders):
    placeholder._element.getparent().remove(placeholder._element)
deck.save(dst)
PY
soffice --headless "-env:UserInstallation=file://$work/lo" \
	--convert-to pdf --outdir "$work" "$work/background.pptx" >/dev/null
pdftoppm -png -singlefile -scale-to-x 3840 -scale-to-y 2160 \
	"$work/background.pdf" "$work/background"
mkdir -p "$root/public/template"
mv "$work/background.png" "$root/public/template/winlab-background.png"
rm -rf "$work"
echo "template-background: public/template/winlab-background.png"
