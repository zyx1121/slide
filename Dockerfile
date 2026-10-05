# One image for every role: `slide web` (the default) serves the app and
# `slide migrate` applies the schema and exits (docker-entrypoint.sh).
FROM node:22-alpine AS build
# bun installs and runs the scripts; node runs `next build` itself.
COPY --from=oven/bun:1.4.2-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

# Manifests first, so a source change does not reinstall the dependencies.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# The fonts are pinned by their script, so they download again only when it
# changes.
COPY scripts/fetch-fonts.sh scripts/
RUN sh scripts/fetch-fonts.sh

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build && bun run build:migrate && bun run build:worker

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/fonts/slide ./fonts/slide
COPY --from=build --chown=node:node /app/template/*.pptx ./template/
COPY --from=build --chown=node:node /app/dist/migrate.mjs ./dist/migrate.mjs
COPY --from=build --chown=node:node /app/dist/import-worker.mjs ./dist/import-worker.mjs
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY docker-entrypoint.sh /usr/local/bin/slide
# Uploaded images. A new volume mounted here takes this directory's owner.
RUN mkdir -p /data/assets && chown node:node /data/assets
ENV ASSETS_DIR=/data/assets

USER node
EXPOSE 3000
ENTRYPOINT ["slide"]
CMD ["web"]
