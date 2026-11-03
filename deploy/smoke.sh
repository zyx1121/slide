#!/usr/bin/env bash
# The image as deployed: the stack from .env.example with Postgres and the
# migrate job, then scripts/smoke.sh. ci runs it with the image loaded as
# ghcr.io/zyx1121/slide:ci.
set -euo pipefail
trap 'docker compose logs' EXIT
sed -e 's/^SLIDE_VERSION=.*/SLIDE_VERSION=ci/' \
    -e 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=ci-postgres/' \
    -e 's|^OIDC_ISSUER=.*|OIDC_ISSUER=http://127.0.0.1:9/realms/ci|' \
    -e 's/^OIDC_CLIENT_ID=.*/OIDC_CLIENT_ID=slide/' \
    -e 's/^OIDC_CLIENT_SECRET=.*/OIDC_CLIENT_SECRET=ci-secret/' \
    -e 's/^ALLOWED_EMAILS=.*/ALLOWED_EMAILS=ci@example.org/' \
    -e "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" \
    .env.example > .env
docker compose up -d
sh scripts/smoke.sh
