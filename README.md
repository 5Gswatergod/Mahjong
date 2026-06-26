# Taiwan Mahjong Online MVP

線上四人台灣 16 張麻將 MVP。此專案使用 TypeScript npm workspaces：

- `apps/web`: React + Vite client
- `apps/server`: Fastify + Socket.IO server
- `packages/game-core`: 台灣麻將規則與狀態機
- `packages/shared`: 共用型別

## Quick Start

```bash
npm install
npm run dev -w apps/server
npm run dev -w apps/web
```

Web: http://localhost:5173
API/Socket server: http://localhost:4000

## Notes

第一版採神來也公開規則教學的近似規則，不使用神來也品牌、UI 或素材。虛擬幣僅供娛樂記分，不提供現金交易。
