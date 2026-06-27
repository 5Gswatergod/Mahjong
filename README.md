# Taiwan Mahjong Online MVP

React + Fastify + Socket.IO 的線上麻將 MVP，使用 npm workspaces 管理前端、後端與共用套件。

## Structure

- `apps/web`: React + Vite client
- `apps/server`: Fastify + Socket.IO server
- `packages/game-core`: Mahjong rules and game state engine
- `packages/shared`: Shared TypeScript types and constants

## Local development

```bash
npm install
npm run dev
```

Web: http://localhost:5173

API / Socket server: http://localhost:4000

## Checks

```bash
npm run typecheck
npm run test
npm run build
```

## Production deployment

This repo can build one Docker image that serves both the Vite frontend and the Fastify / Socket.IO backend.

- Docker image workflow: `.github/workflows/publish-image.yml`
- Oracle VM deploy workflow: `.github/workflows/deploy-oracle.yml`
- Oracle + Cloudflare guide: `docs/ORACLE_CLOUD_DEPLOYMENT.md`

Default GHCR image:

```txt
ghcr.io/5gswatergod/mahjong
```
