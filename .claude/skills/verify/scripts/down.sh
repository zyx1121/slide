#!/bin/sh
# Tears down what up.sh started for one run: the compose project with its
# volumes, and the image tag. Keeps the run's evidence/ folder.
#
#   sh .claude/skills/verify/scripts/down.sh <run dir>
set -eu
run=${1:?usage: down.sh <run dir>}
DOCKER=${DOCKER:-docker}
. "$run/state"
$DOCKER compose -p "$PROJECT" -f "$run/compose.yaml" down -v --remove-orphans >/dev/null 2>&1 || true
$DOCKER image rm "$IMAGE" >/dev/null 2>&1 || true
rm -f "$run/.env" "$run/compose.yaml"
ls "$run/evidence" >/dev/null || {
	echo "down: $run/evidence is missing" >&2
	exit 1
}
echo "down: removed $PROJECT; evidence kept in $run/evidence"
