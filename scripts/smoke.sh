#!/bin/sh
# Smoke test for a stack started with `docker compose up -d`: the migrate job
# exits 0, the web service turns healthy, /api/health reaches Postgres, the
# first migration is applied, and the home page renders.
#
#   sh scripts/smoke.sh
set -eu
web=${WEB_URL:-http://127.0.0.1:3000}

fail() {
	echo "smoke: $*" >&2
	exit 1
}

tries=0
until [ "$(docker compose ps web --format '{{.Health}}')" = healthy ]; do
	tries=$((tries + 1))
	[ "$tries" -lt 60 ] || fail "web never became healthy"
	sleep 2
done

[ "$(docker compose ps -a migrate --format '{{.ExitCode}}')" = 0 ] ||
	fail "migrate did not exit 0"

health=$(curl -fsS "$web/api/health")
echo "$health" | grep -q '"db":"ok"' || fail "unexpected health: $health"

applied=$(docker compose exec -T postgres psql -U slide -d slide -tAc \
	"select count(*) from schema_migrations where name = '0001_init.sql'")
[ "$applied" = 1 ] || fail "0001_init.sql was not applied"
docker compose exec -T postgres psql -U slide -d slide -tAc \
	"select count(*) from decks" >/dev/null || fail "the decks table is missing"

curl -fsS "$web/" | grep -q "<title>slide</title>" ||
	fail "the home page did not render"

echo "smoke: ok"
