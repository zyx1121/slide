#!/bin/sh
# Starts a throwaway slide stack for one verification run: builds the image
# from this checkout, runs Postgres, the migrate job and the web app under
# their own compose project and port, and waits until the app answers
# /api/health with the database up. Prints the run's state file.
#
#   sh .claude/skills/verify/scripts/up.sh
#
# Env: RUN_ID (default: a timestamp), PORT (default 3460), VERIFY_HOME
# (default ~/work/verify/slide), DOCKER (default docker; "sudo docker" where
# the user is not in the docker group).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../.." && pwd)
DOCKER=${DOCKER:-docker}
RUN_ID=${RUN_ID:-$(date +%Y%m%d-%H%M%S)}
PORT=${PORT:-3460}
VERIFY_HOME=${VERIFY_HOME:-$HOME/work/verify/slide}
run="$VERIFY_HOME/$RUN_ID"
project="slide-verify-$RUN_ID"
tag="verify-$RUN_ID"

fail() {
	echo "up: $*" >&2
	exit 1
}

[ ! -e "$run" ] || fail "$run exists; pick another RUN_ID"
if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
	fail "port $PORT is taken; set PORT"
fi
mkdir -p "$run/evidence"

$DOCKER build -q -t "ghcr.io/zyx1121/slide:$tag" "$root" >/dev/null

cp "$root/compose.yaml" "$run/compose.yaml"
cat >"$run/.env" <<EOF
SLIDE_VERSION=$tag
POSTGRES_PASSWORD=$(openssl rand -hex 16)
SLIDE_BIND=127.0.0.1
SLIDE_PORT=$PORT
APP_URL=http://127.0.0.1:$PORT
OIDC_ISSUER=http://127.0.0.1:9/
OIDC_CLIENT_ID=verify
OIDC_CLIENT_SECRET=verify
ALLOWED_EMAILS=verify@example.test
SESSION_SECRET=$(openssl rand -hex 32)
EOF
chmod 600 "$run/.env"

cat >"$run/state" <<EOF
RUN_ID=$RUN_ID
PROJECT=$project
PORT=$PORT
IMAGE=ghcr.io/zyx1121/slide:$tag
URL=http://127.0.0.1:$PORT
EOF

$DOCKER compose -p "$project" -f "$run/compose.yaml" up -d --quiet-pull >/dev/null 2>&1 ||
	fail "compose up failed; run doctor.sh $run"

tries=0
until curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"db":"ok"'; do
	tries=$((tries + 1))
	[ "$tries" -lt 90 ] || fail "the app never reported db ok; run doctor.sh $run"
	sleep 2
done

# The verification member. A real sign-in writes this row in the OIDC
# callback; session.ts skips that callback, so the row is seeded here.
$DOCKER compose -p "$project" -f "$run/compose.yaml" exec -T postgres \
	psql -U slide -d slide -qc "insert into users (sub, name, email) values ('verify-member', 'Verify Member', 'verify@example.test') on conflict do nothing" ||
	fail "could not seed the verification member"

echo "$run"
