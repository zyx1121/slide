#!/bin/sh
# Installs the pinned Playwright and its Chromium once, outside the checkout,
# and prints the folder to pass as PW_DIR. Safe to run every time.
#
#   export PW_DIR=$(sh .claude/skills/verify/scripts/pw.sh)
set -eu
version=1.64.1
dir=${VERIFY_HOME:-$HOME/work/verify/slide}/.pw-$version
if [ ! -f "$dir/node_modules/playwright/package.json" ]; then
	mkdir -p "$dir"
	npm install --prefix "$dir" --no-save --silent "playwright@$version" >&2
fi
"$dir/node_modules/.bin/playwright" install chromium >&2
echo "$dir"
