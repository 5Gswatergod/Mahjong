# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/game-core/package.json packages/game-core/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

FROM deps AS build
WORKDIR /app

COPY tsconfig.base.json ./
COPY apps apps
COPY packages packages
COPY assets assets

RUN npm run typecheck
RUN npm run test
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV STATIC_DIR=/app/apps/web/dist

RUN groupadd --system nodejs \
  && useradd --system --gid nodejs --home-dir /app appuser

COPY --from=build --chown=appuser:nodejs /app/package.json /app/package-lock.json ./
COPY --from=build --chown=appuser:nodejs /app/node_modules node_modules
COPY --from=build --chown=appuser:nodejs /app/apps/server/package.json apps/server/package.json
COPY --from=build --chown=appuser:nodejs /app/apps/server/dist apps/server/dist
COPY --from=build --chown=appuser:nodejs /app/apps/web/dist apps/web/dist
COPY --from=build --chown=appuser:nodejs /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=appuser:nodejs /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=appuser:nodejs /app/packages/game-core/package.json packages/game-core/package.json
COPY --from=build --chown=appuser:nodejs /app/packages/game-core/dist packages/game-core/dist

USER appuser

EXPOSE 4000

CMD ["node", "apps/server/dist/index.js"]
