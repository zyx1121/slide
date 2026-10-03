#!/bin/sh
# Smoke test for a stack started with `docker compose up -d`: the migrate job
# exits 0, the web service turns healthy, /api/health reaches Postgres, the
# first migration is applied, a signed-out visit goes to sign-in, and a page
# renders dark first.
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

# Signed out, a page sends the visitor to sign-in on APP_URL, keeping the path.
app=${APP_URL:-http://localhost:3000}
location=$(curl -sS -o /dev/null -w '%{redirect_url}' "$web/decks/x?y=1")
[ "$location" = "$app/auth/login?next=%2Fdecks%2Fx%3Fy%3D1" ] ||
	fail "a signed-out visit was not sent to sign-in: $location"

# A page renders in the shell, dark first.
page=$(curl -fsS "$web/auth/error?reason=expired")
echo "$page" | grep -q '登入逾時' || fail "the sign-in error page did not render"
echo "$page" | grep -q '<html[^>]*class="[^"]*dark' ||
	fail "the page is not dark first"

echo "smoke: ok"
