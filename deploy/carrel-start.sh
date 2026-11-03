#!/bin/sh
# carrel-deployd (from land) runs this from the release directory on every
# deploy and rollback. It points the Compose stack in /opt/slide at the image
# in VERSION, reports ready once web is healthy, then follows the web logs.
# The unit needs Type=notify and NotifyAccess=all.
set -eu

version=$(cat VERSION)
# The release carries the stack's compose.yaml, so the repo is its source.
if [ -f compose.yaml ]; then
  cp compose.yaml /opt/slide/compose.yaml.new
  mv /opt/slide/compose.yaml.new /opt/slide/compose.yaml
fi
cd /opt/slide

tmp=$(mktemp .env.XXXXXX)
sed "s/^SLIDE_VERSION=.*/SLIDE_VERSION=$version/" .env >"$tmp"
chmod --reference=.env "$tmp"
mv "$tmp" .env

docker compose pull --quiet migrate web
docker compose up -d --wait web
systemd-notify --ready
exec docker compose logs -f --since 1s web
