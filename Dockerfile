# One image for every role: `slide web` (the default) serves the app and
# `slide migrate` applies the schema and exits (docker-entrypoint.sh).
FROM node:22-alpine AS build
# bun installs and runs the scripts; node runs `next build` itself.
COPY --from=oven/bun:1.4.2-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

# Manifests first, so a source change does not reinstall the dependencies.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN sh scripts/fetch-fonts.sh && bun run build && bun run build:migrate

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/fonts/slide ./fonts/slide
COPY --from=build --chown=node:node /app/dist/migrate.mjs ./dist/migrate.mjs
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY docker-entrypoint.sh /usr/local/bin/slide

USER node
EXPOSE 3000
ENTRYPOINT ["slide"]
CMD ["web"]
