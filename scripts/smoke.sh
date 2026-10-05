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

# The web service can write uploaded images to its volume.
docker compose exec -T web sh -c 'touch "$ASSETS_DIR/.smoke" && rm "$ASSETS_DIR/.smoke"' ||
	fail "the web service cannot write to ASSETS_DIR"

# The import worker is in the image and loads: a file that is not a .pptx
# comes back as such, read in a worker thread.
docker compose exec -T web node -e '
const { Worker } = require("node:worker_threads");
const worker = new Worker("./dist/import-worker.mjs", { workerData: { bytes: new Uint8Array([1, 2, 3]) } });
worker.once("message", (outcome) => { console.log(outcome.code); process.exit(0); });
worker.once("error", (error) => { console.error(error); process.exit(1); });
' | grep -qx not-pptx || fail "the import worker did not read a file"

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
