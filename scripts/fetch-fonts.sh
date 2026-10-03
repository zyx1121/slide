#!/bin/sh
# Downloads the fonts slides are drawn with into fonts/slide/: Carlito, which
# has Calibri's metrics (the WinLab template's font), and Noto Sans TC for
# CJK, and Noto Emoji. They are pinned by commit and checked by sha256. The server renders
# PNGs with them (lib/render/png.ts); the image and CI run this script.
#
#   sh scripts/fetch-fonts.sh
set -eu
dir=$(dirname "$0")/../fonts/slide
mkdir -p "$dir"

carlito=https://raw.githubusercontent.com/google/fonts/3dd78844021e948ceb633d1dcee3f7885561b5d9/ofl/carlito
noto=https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/SubsetOTF/TC
emoji=https://raw.githubusercontent.com/google/fonts/3dd78844021e948ceb633d1dcee3f7885561b5d9/ofl/notoemoji

fetch() {
	file=$1 url=$2 sum=$3
	if [ -f "$dir/$file" ] && echo "$sum  $dir/$file" | sha256sum -c - >/dev/null 2>&1; then
		return
	fi
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL -o "$dir/$file.part" "$url"
	else
		wget -qO "$dir/$file.part" "$url"
	fi
	echo "$sum  $dir/$file.part" | sha256sum -c - >/dev/null || {
		echo "fetch-fonts: $file does not match its sha256" >&2
		rm -f "$dir/$file.part"
		exit 1
	}
	mv "$dir/$file.part" "$dir/$file"
}

fetch Carlito-Regular.ttf "$carlito/Carlito-Regular.ttf" f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595
fetch Carlito-Bold.ttf "$carlito/Carlito-Bold.ttf" bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db
fetch Carlito-Italic.ttf "$carlito/Carlito-Italic.ttf" 0b019225e58d702bfedcbd35c21696769f8ee115cb6343f84c2f240312450d1c
fetch Carlito-BoldItalic.ttf "$carlito/Carlito-BoldItalic.ttf" b32928186c119599e03ca6a1ffc680fdcb7fac95772f4b95d989cf6cd3861517
fetch NotoSansTC-Regular.otf "$noto/NotoSansTC-Regular.otf" 5bab0cb3c1cf89dde07c4a95a4054b195afbcfe784d69d75c340780712237537
fetch NotoSansTC-Bold.otf "$noto/NotoSansTC-Bold.otf" 55420b259eb119bf5f2a0aadba10cf9d736c12d64ab93e78546d69ef5f43558b
# Monochrome emoji, so emoji on the server are drawn rather than tofu boxes.
fetch NotoEmoji.ttf "$emoji/NotoEmoji%5Bwght%5D.ttf" de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551
echo "fetch-fonts: fonts/slide is ready"
