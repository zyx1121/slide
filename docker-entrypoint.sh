#!/bin/sh
# Picks the role: `web` (the default) serves the app, `migrate` applies the
# schema and exits. Anything else runs as a plain command.
set -e
case "${1:-web}" in
web) exec node server.js ;;
migrate) exec node dist/migrate.mjs ;;
*) exec "$@" ;;
esac
