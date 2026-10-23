#!/bin/sh
# Read-only check that a verification stack is worth driving: it was started
# by up.sh, the web container runs this run's image, the migrate job exited 0,
# and /api/health reaches the database. Exits non-zero on the first problem.
#
#   sh .claude/skills/verify/scripts/doctor.sh <run dir>
set -eu
run=${1:?usage: doctor.sh <run dir>}
DOCKER=${DOCKER:-docker}
[ -f "$run/state" ] || {
	echo "doctor: $run has no state file; up.sh did not start it" >&2
	exit 1
}
. "$run/state"
dc() { $DOCKER compose -p "$PROJECT" -f "$run/compose.yaml" "$@"; }

image=$(dc ps web --format '{{.Image}}')
[ "$image" = "$IMAGE" ] || {
	echo "doctor: web runs '$image', expected $IMAGE" >&2
	exit 1
}
[ "$(dc ps -a migrate --format '{{.ExitCode}}')" = 0 ] || {
	echo "doctor: migrate did not exit 0" >&2
	dc logs migrate | tail -20 >&2
	exit 1
}
health=$(curl -fsS "$URL/api/health") || {
	echo "doctor: $URL/api/health did not answer" >&2
	dc logs web | tail -20 >&2
	exit 1
}
echo "$health" | grep -q '"db":"ok"' || {
	echo "doctor: unexpected health: $health" >&2
	exit 1
}
echo "doctor: ok $PROJECT $URL $IMAGE"
