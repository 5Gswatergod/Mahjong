import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  applyClaim,
  applyDeclareRiichi,
  applyDeclareTing,
  applyDiscard,
  applyKong,
  applySelfDrawWin,
  autoDiscardIfNeeded,
  autoTingDiscardIfNeeded,
  createGame,
  type CoreGame,
  getPrivateState,
  passExpiredClaimWindow,
  passExpiredTurn,
  seatDistance,
  toPublicGameState
} from "@taiwan-mahjong/game-core";
import {
  type AdminAuditEntry,
  DEFAULT_GAME_CONFIG,
  type ClientToServerEvents,
  type GameConfig,
  type GameMode,
  type LegalAction,
  type PlayerSeat,
  type RoomEntryResponse,
  type RoomSnapshot,
  type SeatDrawResult,
  type ServerToClientEvents,
  type SocketData,
  type SocketRole,
  type Tile,
  winds
} from "@taiwan-mahjong/shared";
import {
  buildVisibleTileCounts,
  chooseBotClaimAction,
  chooseBotTurnAction,
  type BotDecisionContext,
  type BotVisiblePlayer
} from "./bot-policy.js";
import { ADMIN_COOKIE_NAME, AdminSessionManager, buildAdminDashboard, type AdminRoomSource } from "./admin.js";
import { MemoryEventStore, PgEventStore, type EventStore, resolveDatabaseConnection } from "./event-store.js";
import { resolveRoomEntryRole } from "./room-entry.js";
import { applySeatDrawResult, createSeatDrawResult } from "./seat-draw.js";
import { shouldIndexHtmlPath, staticCacheControl } from "./static-cache.js";

declare module "@taiwan-mahjong/shared" {
  interface SocketData {
    playerId: string;
    roomCode: string;
    role: SocketRole;
    seatIndex?: number;
  }
}

type InterServerEvents = Record<string, never>;

interface GuestSession {
  playerId: string;
  name: string;
  token: string;
}

interface Room {
  code: string;
  mode: GameMode;
  config: GameConfig;
  hostPlayerId: string;
  seats: PlayerSeat[];
  seatDraw?: SeatDrawResult;
  game?: CoreGame;
  createdAt: number;
  updatedAt: number;
  disconnectTimers: Map<string, NodeJS.Timeout>;
  seatDrawTimer?: NodeJS.Timeout;
  botTimer?: NodeJS.Timeout;
  autoTingTimer?: NodeJS.Timeout;
}

interface RoomSnapshotOptions {
  revealHands?: boolean;
}

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const port = Number(process.env.PORT ?? 4000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const staticDir = process.env.STATIC_DIR ?? path.resolve(currentDir, "../../web/dist");
const serverStartedAt = Date.now();
const fastify = Fastify({ logger: true });
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(fastify.server, {
  cors: {
    origin: webOrigin,
    credentials: true
  }
});
type MahjongSocket = Parameters<Parameters<typeof io.on>[1]>[0];

const sessions = new Map<string, GuestSession>();
const rooms = new Map<string, Room>();
const databaseConnection = resolveDatabaseConnection();
const eventStore: EventStore = databaseConnection ? new PgEventStore(databaseConnection) : new MemoryEventStore();
const adminSessions = new AdminSessionManager(process.env.ADMIN_PASSWORD);
const recentAdminActions: AdminAuditEntry[] = [];

await eventStore.init();
await fastify.register(cookie);
await fastify.register(cors, { origin: webOrigin, credentials: true });

const roomConfigSchema = z
  .object({
    basePoints: z.number().int().min(0).max(100_000).optional(),
    pointPerTai: z.number().int().min(0).max(10_000).optional(),
    initialCoins: z.number().int().min(1_000).max(100_000).optional(),
    aiDifficulty: z.enum(["novice", "beginner", "dreamer", "expert"]).optional(),
    disconnectGraceMs: z.number().int().min(10_000).max(300_000).optional(),
    claimWindowMs: z.number().int().min(3_000).max(30_000).optional(),
    autoDiscardMs: z.number().int().min(5_000).max(120_000).optional(),
    latencyGraceMs: z.number().int().min(0).max(5_000).optional()
  })
  .partial();

fastify.get("/health", async () => ({
  ok: true,
  uptime: process.uptime(),
  rooms: rooms.size,
  persistence: databaseConnection ? "postgres" : "memory"
}));

fastify.get("/api/time", async () => ({
  serverTime: Date.now()
}));

fastify.get("/api/admin/session", async (request) => {
  const expiresAt = adminSessions.getExpiresAt(request.cookies[ADMIN_COOKIE_NAME]);
  return {
    configured: adminSessions.configured,
    authenticated: typeof expiresAt === "number",
    ...(typeof expiresAt === "number" ? { expiresAt } : {})
  };
});

fastify.post("/api/admin/session", async (request, reply) => {
  const body = z.object({ password: z.string().min(1).max(256) }).parse(request.body ?? {});
  const result = adminSessions.login(body.password, request.ip);

  if (result.status === "unconfigured") {
    return reply.code(503).send({ code: "ADMIN_NOT_CONFIGURED", message: "管理員後台尚未設定密碼。" });
  }
  if (result.status === "rateLimited") {
    reply.header("Retry-After", result.retryAfterSeconds);
    return reply.code(429).send({ code: "ADMIN_LOGIN_RATE_LIMITED", message: "登入失敗次數過多，請稍後再試。" });
  }
  if (result.status === "invalid") {
    return reply.code(401).send({ code: "INVALID_ADMIN_PASSWORD", message: "管理員密碼不正確。" });
  }

  reply.setCookie(ADMIN_COOKIE_NAME, result.token, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor((result.expiresAt - Date.now()) / 1000)
  });
  return {
    configured: true,
    authenticated: true,
    expiresAt: result.expiresAt
  };
});

fastify.delete("/api/admin/session", async (request, reply) => {
  adminSessions.logout(request.cookies[ADMIN_COOKIE_NAME]);
  reply.clearCookie(ADMIN_COOKIE_NAME, { path: "/" });
  return { configured: adminSessions.configured, authenticated: false };
});

fastify.get("/api/admin/dashboard", async (request, reply) => {
  if (!adminSessions.getExpiresAt(request.cookies[ADMIN_COOKIE_NAME])) {
    return reply.code(401).send({ message: "管理員登入已過期。" });
  }

  return buildAdminDashboard({
    rooms: [...rooms.values()].map(toAdminRoomSource),
    recentActions: recentAdminActions,
    startedAt: serverStartedAt,
    persistence: databaseConnection ? "postgres" : "memory"
  });
});

fastify.post("/api/admin/rooms/:code/close", async (request, reply) => {
  if (!adminSessions.getExpiresAt(request.cookies[ADMIN_COOKIE_NAME])) {
    return reply.code(401).send({ message: "管理員登入已過期。" });
  }

  const params = z.object({ code: z.string().trim().min(4).max(8) }).parse(request.params);
  const body = z.object({ reason: z.string().trim().max(120).optional() }).parse(request.body ?? {});
  const roomCode = params.code.toUpperCase();
  const room = rooms.get(roomCode);
  if (!room) {
    return reply.code(404).send({ message: "房間不存在或已關閉。" });
  }

  const createdAt = Date.now();
  await persist(room.code, "admin.roomClosed", { reason: body.reason ?? null });
  disposeRoom(room);
  rooms.delete(room.code);
  disconnectRoomClients(room.code, body.reason);
  recentAdminActions.unshift({
    id: `admin_action_${nanoid(10)}`,
    action: "room.closed",
    roomCode: room.code,
    ...(body.reason ? { reason: body.reason } : {}),
    createdAt
  });
  recentAdminActions.splice(30);

  return { ok: true, roomCode: room.code };
});

fastify.post("/api/auth/guest", async (request) => {
  const body = z.object({ name: z.string().trim().min(1).max(20).optional() }).parse(request.body ?? {});
  const playerId = `player_${nanoid(10)}`;
  const name = body.name ?? `牌友${playerId.slice(-4)}`;
  const token = `guest_${nanoid(32)}`;
  const session = { playerId, name, token };
  sessions.set(token, session);
  return session;
});

fastify.patch("/api/auth/guest", async (request, reply) => {
  const session = authenticateRequest(request.headers.authorization);
  if (!session) {
    return reply.code(401).send({ message: "Missing or invalid guest token." });
  }

  const body = z.object({ name: z.string().trim().min(1).max(20) }).parse(request.body ?? {});
  session.name = body.name;

  for (const room of rooms.values()) {
    const seat = room.seats.find((candidate) => candidate.playerId === session.playerId);
    if (!seat || seat.isBot) {
      continue;
    }

    seat.name = session.name;
    if (room.game?.players[seat.seatIndex]) {
      room.game.players[seat.seatIndex]!.name = session.name;
    }
    room.updatedAt = Date.now();
    await persist(room.code, "player.renamed", { playerId: session.playerId, name: session.name });
    broadcastRoom(room);
  }

  return session;
});

fastify.post("/api/rooms", async (request, reply) => {
  const session = authenticateRequest(request.headers.authorization);
  if (!session) {
    return reply.code(401).send({ message: "Missing or invalid guest token." });
  }

  const body = z
    .object({
      mode: z.enum(["taiwan", "riichi"]).default("taiwan"),
      config: roomConfigSchema.optional()
    })
    .parse(request.body ?? {});
  const room = createRoom(session, body.mode, stripUndefinedConfig(body.config));
  rooms.set(room.code, room);
  await persist(room.code, "room.created", { hostPlayerId: session.playerId, mode: room.mode, config: room.config });
  return snapshotRoom(room);
});

fastify.post("/api/rooms/:code/bots", async (request, reply) => {
  const session = authenticateRequest(request.headers.authorization);
  if (!session) {
    return reply.code(401).send({ message: "Missing or invalid guest token." });
  }
  const params = z.object({ code: z.string().trim().min(4).max(8) }).parse(request.params);
  const body = z.object({ seatIndex: z.number().int().min(0).max(3) }).parse(request.body ?? {});
  const room = rooms.get(params.code.toUpperCase());
  if (!room) {
    return reply.code(404).send({ message: "Room not found." });
  }
  addBotToRoom(room, session.playerId, body.seatIndex);
  await persist(room.code, "room.botAdded", { seatIndex: body.seatIndex });
  maybeStartHand(room);
  broadcastRoom(room);
  scheduleBot(room);
  return snapshotRoom(room);
});

fastify.post("/api/rooms/:code/join", async (request, reply) => {
  const session = authenticateRequest(request.headers.authorization);
  if (!session) {
    return reply.code(401).send({ message: "Missing or invalid guest token." });
  }
  const params = z.object({ code: z.string().trim().min(4).max(8) }).parse(request.params);
  const room = rooms.get(params.code.toUpperCase());
  if (!room) {
    return reply.code(404).send({ message: "Room not found." });
  }
  const existing = room.seats.find((seat) => seat.playerId === session.playerId);
  const full = room.seats.every((seat) => seat.playerId);
  if (!existing && full) {
    return reply.code(409).send({ code: "ROOM_FULL", message: "Room is full." });
  }

  joinRoom(room, session);
  await persist(room.code, "room.joined", { playerId: session.playerId });
  broadcastRoom(room);
  return snapshotRoom(room);
});

fastify.post("/api/rooms/:code/enter", async (request, reply) => {
  const session = authenticateRequest(request.headers.authorization);
  if (!session) {
    return reply.code(401).send({ message: "Missing or invalid guest token." });
  }
  const params = z.object({ code: z.string().trim().min(4).max(8) }).parse(request.params);
  const room = rooms.get(params.code.toUpperCase());
  if (!room) {
    return reply.code(404).send({ message: "Room not found." });
  }

  const role = resolveRoomEntryRole(
    { seats: room.seats, seatDrawActive: Boolean(room.seatDraw) },
    session.playerId
  );
  if (role === "player") {
    const alreadySeated = room.seats.some((seat) => seat.playerId === session.playerId);
    joinRoom(room, session);
    if (!alreadySeated) {
      await persist(room.code, "room.joined", { playerId: session.playerId, source: "roomLink" });
      broadcastRoom(room);
    }
  }

  const response: RoomEntryResponse = { role, room: snapshotRoom(room) };
  return response;
});

fastify.get("/api/rooms/:code", async (request, reply) => {
  const params = z.object({ code: z.string().trim().min(4).max(8) }).parse(request.params);
  const room = rooms.get(params.code.toUpperCase());
  if (!room) {
    return reply.code(404).send({ message: "Room not found." });
  }
  return snapshotRoom(room);
});

if (existsSync(path.join(staticDir, "index.html"))) {
  await fastify.register(fastifyStatic, {
    root: staticDir,
    prefix: "/",
    cacheControl: false,
    setHeaders(response, filePath) {
      response.header("Cache-Control", staticCacheControl(filePath));
    }
  });

  fastify.setNotFoundHandler((request, reply) => {
    const requestPath = request.url.split("?")[0] ?? "/";
    if (requestPath === "/api" || requestPath.startsWith("/api/") || requestPath.startsWith("/socket.io")) {
      return reply.code(404).send({ message: "Not found." });
    }

    if (request.headers.accept?.includes("text/html")) {
      if (!shouldIndexHtmlPath(requestPath)) {
        reply.header("X-Robots-Tag", "noindex, nofollow");
      }
      return reply.sendFile("index.html");
    }

    return reply.code(404).send({ message: "Not found." });
  });
}

io.use((socket, next) => {
  const token = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : "";
  const roomCode = typeof socket.handshake.auth.roomCode === "string" ? socket.handshake.auth.roomCode.toUpperCase() : "";
  const spectator = socket.handshake.auth.spectator === true;
  const session = sessions.get(token);
  const room = rooms.get(roomCode);
  if (!session || !room) {
    next(new Error("Invalid socket auth."));
    return;
  }
  socket.data.playerId = session.playerId;
  socket.data.roomCode = room.code;
  if (spectator) {
    socket.data.role = "spectator";
    next();
    return;
  }
  const seat = room.seats.find((candidate) => candidate.playerId === session.playerId);
  if (!seat) {
    next(new Error("Player is not seated in this room."));
    return;
  }
  socket.data.role = "player";
  socket.data.seatIndex = seat.seatIndex;
  next();
});

io.on("connection", (socket) => {
  const room = rooms.get(socket.data.roomCode);
  if (!room) {
    socket.disconnect(true);
    return;
  }

  socket.join(room.code);
  if (socket.data.role === "player") {
    const seatIndex = requirePlayerSeatIndex(socket);
    clearDisconnectTimer(room, socket.data.playerId);
    setConnected(room, socket.data.playerId, true);
    socket.emit("connection.recovered", { role: "player", roomCode: room.code, seatIndex });
    emitFullState(room, socket.id);
    broadcastRoom(room);
  } else {
    socket.emit("connection.recovered", { role: "spectator", roomCode: room.code });
    emitFullState(room, socket.id);
  }

  socket.on("room.ready", async ({ ready }) => {
    await handleSocketAction(socket, async () => {
      requirePlayerSeatIndex(socket);
      const currentRoom = requireRoom(socket.data.roomCode);
      if (currentRoom.seatDraw) {
        throw new Error("正在抓位，請稍候。");
      }
      const seat = requireSeat(currentRoom, socket.data.playerId);
      seat.ready = ready;
      currentRoom.updatedAt = Date.now();
      await persist(currentRoom.code, "room.ready", { playerId: socket.data.playerId, ready });
      maybeStartHand(currentRoom);
      broadcastRoom(currentRoom);
      scheduleBot(currentRoom);
    });
  });

  socket.on("room.addBot", async ({ seatIndex }) => {
    await handleSocketAction(socket, async () => {
      requirePlayerSeatIndex(socket);
      const currentRoom = requireRoom(socket.data.roomCode);
      addBotToRoom(currentRoom, socket.data.playerId, seatIndex);
      await persist(currentRoom.code, "room.botAdded", { seatIndex });
      maybeStartHand(currentRoom);
      broadcastRoom(currentRoom);
      scheduleBot(currentRoom);
    });
  });

  socket.on("room.clearSeat", async ({ seatIndex }) => {
    await handleSocketAction(socket, async () => {
      requirePlayerSeatIndex(socket);
      const currentRoom = requireRoom(socket.data.roomCode);
      const clearedPlayerId = currentRoom.seats[seatIndex]?.playerId;
      clearSeatInRoom(currentRoom, socket.data.playerId, seatIndex);
      if (clearedPlayerId) {
        detachPlayerSockets(currentRoom, clearedPlayerId, "座位已由房主釋出。");
      }
      await persist(currentRoom.code, "room.seatCleared", { seatIndex, clearedPlayerId });
      broadcastRoom(currentRoom);
    });
  });

  socket.on("room.leave", async () => {
    await handleSocketAction(socket, async () => {
      const currentRoom = requireRoom(socket.data.roomCode);
      if (socket.data.role === "spectator") {
        socket.leave(currentRoom.code);
        return;
      }
      const seatIndex = requirePlayerSeatIndex(socket);
      const seat = requireSeat(currentRoom, socket.data.playerId);
      seat.ready = false;
      seat.connected = false;
      if (currentRoom.game) {
        currentRoom.game.players[seatIndex]!.connected = false;
      }
      await persist(currentRoom.code, "room.left", { playerId: socket.data.playerId });
      broadcastRoom(currentRoom);
      socket.leave(currentRoom.code);
    });
  });

  socket.on("game.discard", async ({ tileId }) => {
    await handleGameAction(socket, "game.discard", () => {
      const currentRoom = requireRoom(socket.data.roomCode);
      applyDiscard(requireGame(currentRoom), requirePlayerSeatIndex(socket), tileId);
      afterGameMutation(currentRoom);
    });
  });

  socket.on("game.claim", async ({ type, tileIds }) => {
    await handleGameAction(socket, "game.claim", () => {
      const currentRoom = requireRoom(socket.data.roomCode);
      const currentGame = requireGame(currentRoom);
      const seatIndex = requirePlayerSeatIndex(socket);
      if (type === "win" && currentGame.phase === "playing") {
        applySelfDrawWin(currentGame, seatIndex);
      } else {
        applyClaim(currentGame, seatIndex, type, tileIds ?? []);
      }
      afterGameMutation(currentRoom);
    });
  });

  socket.on("game.kong", async ({ tileIds, meldId }) => {
    await handleGameAction(socket, "game.kong", () => {
      const currentRoom = requireRoom(socket.data.roomCode);
      applyKong(requireGame(currentRoom), requirePlayerSeatIndex(socket), tileIds, meldId);
      afterGameMutation(currentRoom);
    });
  });

  socket.on("game.declareTing", async () => {
    await handleGameAction(socket, "game.declareTing", () => {
      const currentRoom = requireRoom(socket.data.roomCode);
      applyDeclareTing(requireGame(currentRoom), requirePlayerSeatIndex(socket));
      afterGameMutation(currentRoom);
    });
  });

  socket.on("game.declareRiichi", async () => {
    await handleGameAction(socket, "game.declareRiichi", () => {
      const currentRoom = requireRoom(socket.data.roomCode);
      applyDeclareRiichi(requireGame(currentRoom), requirePlayerSeatIndex(socket));
      afterGameMutation(currentRoom);
    });
  });

  socket.on("game.resync", () => {
    emitFullState(room, socket.id);
  });

  socket.on("disconnect", () => {
    const currentRoom = rooms.get(socket.data.roomCode);
    if (!currentRoom) {
      return;
    }
    if (socket.data.role === "spectator") {
      return;
    }
    const seatIndex = requirePlayerSeatIndex(socket);
    setConnected(currentRoom, socket.data.playerId, false);
    currentRoom.disconnectTimers.set(
      socket.data.playerId,
      setTimeout(() => {
        const lateRoom = rooms.get(socket.data.roomCode);
        if (!lateRoom?.game) {
          return;
        }
        const seat = lateRoom.seats.find((candidate) => candidate.playerId === socket.data.playerId);
        if (!seat?.connected) {
          autoDiscardIfNeeded(lateRoom.game, seatIndex);
          afterGameMutation(lateRoom);
        }
      }, DEFAULT_GAME_CONFIG.disconnectGraceMs)
    );
    broadcastRoom(currentRoom);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.game || (room.game.phase !== "claiming" && room.game.phase !== "playing")) {
      continue;
    }
    const before = room.game.updatedAt;
    passExpiredClaimWindow(room.game);
    passExpiredTurn(room.game);
    if (room.game.updatedAt !== before) {
      afterGameMutation(room);
    }
  }
}, 1000).unref();

await fastify.listen({ port, host: "0.0.0.0" });

function createRoom(session: GuestSession, mode: GameMode, configOverrides: Partial<GameConfig> = {}): Room {
  const code = createRoomCode();
  const now = Date.now();
  const config = resolveRoomConfig(mode, configOverrides);
  return {
    code,
    mode,
    config,
    hostPlayerId: session.playerId,
    seats: [
      {
        seatIndex: 0,
        wind: "east",
        playerId: session.playerId,
        name: session.name,
        coins: config.initialCoins,
        ready: false,
        connected: false
      },
      ...winds.slice(1).map((wind, offset) => ({
        seatIndex: offset + 1,
        wind,
        coins: config.initialCoins,
        ready: false,
        connected: false
      }))
    ],
    createdAt: now,
    updatedAt: now,
    disconnectTimers: new Map()
  };
}

function resolveRoomConfig(mode: GameMode, overrides: Partial<GameConfig>): GameConfig {
  return {
    ...DEFAULT_GAME_CONFIG,
    initialCoins: mode === "riichi" ? 25_000 : DEFAULT_GAME_CONFIG.initialCoins,
    ...overrides
  };
}

function stripUndefinedConfig(
  config: Partial<Record<keyof GameConfig, GameConfig[keyof GameConfig] | undefined>> | undefined
): Partial<GameConfig> {
  return Object.fromEntries(Object.entries(config ?? {}).filter(([, value]) => value !== undefined)) as Partial<GameConfig>;
}

function joinRoom(room: Room, session: GuestSession): PlayerSeat {
  const existing = room.seats.find((seat) => seat.playerId === session.playerId);
  if (existing) {
    return existing;
  }
  if (room.seatDraw) {
    throw new Error("抓位中不能加入房間。");
  }
  const seat = room.seats.find((candidate) => !candidate.playerId);
  if (!seat) {
    throw new Error("Room is full.");
  }
  seat.playerId = session.playerId;
  seat.name = session.name;
  seat.coins = room.config.initialCoins;
  seat.ready = false;
  seat.connected = false;
  room.updatedAt = Date.now();
  return seat;
}

function addBotToRoom(room: Room, requesterPlayerId: string, seatIndex: number): PlayerSeat {
  if (requesterPlayerId !== room.hostPlayerId) {
    throw new Error("Only the host can add computer players.");
  }
  if (room.seatDraw) {
    throw new Error("抓位中不能補 AI。");
  }
  if (room.game && room.game.phase !== "settled" && room.game.phase !== "draw") {
    throw new Error("Computer players can only be added before a hand starts.");
  }
  const seat = room.seats[seatIndex];
  if (!seat) {
    throw new Error("Seat not found.");
  }
  if (seat.playerId) {
    throw new Error("Seat is already occupied.");
  }
  seat.playerId = `bot_${nanoid(10)}`;
  seat.name = `電腦 ${seatIndex + 1}`;
  seat.isBot = true;
  seat.ready = true;
  seat.connected = true;
  seat.coins = room.config.initialCoins;
  room.updatedAt = Date.now();
  return seat;
}

function clearSeatInRoom(room: Room, requesterPlayerId: string, seatIndex: number): PlayerSeat {
  if (requesterPlayerId !== room.hostPlayerId) {
    throw new Error("只有房主可以換人。");
  }
  if (room.seatDraw) {
    throw new Error("抓位中不能換人。");
  }
  if (room.game && room.game.phase !== "settled" && room.game.phase !== "draw") {
    throw new Error("只能在未開局或局末換人。");
  }
  const seat = room.seats[seatIndex];
  if (!seat) {
    throw new Error("Seat not found.");
  }
  if (seat.playerId === room.hostPlayerId) {
    throw new Error("房主座位不能由換人功能釋出。");
  }

  delete seat.playerId;
  delete seat.name;
  delete seat.isBot;
  seat.ready = false;
  seat.connected = false;
  seat.coins = room.config.initialCoins;
  room.updatedAt = Date.now();
  return seat;
}

function detachPlayerSockets(room: Room, playerId: string, message: string): void {
  for (const client of io.sockets.sockets.values()) {
    if (client.data.roomCode !== room.code || client.data.role !== "player" || client.data.playerId !== playerId) {
      continue;
    }
    client.emit("game.error", { message });
    client.leave(room.code);
    client.disconnect(true);
  }
}

function maybeStartHand(room: Room): void {
  const full = room.seats.every((seat) => seat.playerId);
  const allReady = room.seats.every((seat) => seat.ready || seat.isBot);
  if (!full || !allReady) {
    return;
  }
  if (room.seatDraw) {
    return;
  }
  if (room.game && room.game.phase !== "settled" && room.game.phase !== "draw") {
    return;
  }

  if (!room.game) {
    startSeatDraw(room);
    return;
  }

  startHand(room);
}

function startSeatDraw(room: Room): void {
  const now = Date.now();
  const draw = createSeatDrawResult(room.seats, { id: `seatdraw_${nanoid(10)}`, now });
  room.seatDraw = draw;
  room.updatedAt = now;
  void persist(room.code, "room.seatDrawStarted", draw);

  room.seatDrawTimer = setTimeout(() => {
    delete room.seatDrawTimer;
    finishSeatDraw(room);
  }, Math.max(0, draw.completeAt - now));
  room.seatDrawTimer.unref();
}

function finishSeatDraw(room: Room): void {
  if (!room.seatDraw || room.game) {
    return;
  }

  const draw = room.seatDraw;
  room.seats = applySeatDrawResult(room.seats, draw);
  syncSocketSeatIndices(room);
  delete room.seatDraw;
  room.updatedAt = Date.now();
  void persist(room.code, "room.seatDrawCompleted", { id: draw.id, cards: draw.cards });
  startHand(room);
  broadcastRoom(room);
  scheduleBot(room);
}

function startHand(room: Room): void {
  const previous = room.game;
  const previousWinner = previous?.settlement?.winnerSeat;
  const previousDealer = previous?.dealerSeat ?? 0;
  const previousRoundIndex = previous?.riichi?.roundIndex ?? 0;
  const dealerContinues = Boolean(
    previous &&
      (previousWinner === previousDealer ||
        (room.mode === "taiwan" && previous.phase === "draw") ||
        (room.mode === "riichi" && previous.settlement?.tenpaiSeats?.includes(previousDealer)))
  );
  const roundIndex = room.mode === "riichi" && previous ? (dealerContinues ? previousRoundIndex : previousRoundIndex + 1) : previousRoundIndex;
  const dealerSeat =
    room.mode === "riichi"
      ? roundIndex % 4
      : dealerContinues
        ? previousDealer
        : previous
          ? (previousDealer + 1) % 4
          : 0;
  const roundWind = room.mode === "riichi" ? (roundIndex >= 4 ? "south" : "east") : "east";
  const dealerStreak = previous && dealerContinues ? previous.dealerStreak + 1 : 0;
  room.game = createGame(room.seats, { mode: room.mode, config: room.config, dealerSeat, roundWind, roundIndex, dealerStreak });
  for (const seat of room.seats) {
    seat.ready = false;
  }
  room.updatedAt = Date.now();
  void persist(room.code, "game.started", { handId: room.game.handId, dealerSeat, dealerStreak, config: room.config });
}

function syncSocketSeatIndices(room: Room): void {
  for (const client of io.sockets.sockets.values()) {
    if (client.data.roomCode !== room.code || client.data.role !== "player") {
      continue;
    }
    const seat = room.seats.find((candidate) => candidate.playerId === client.data.playerId);
    if (seat) {
      client.data.seatIndex = seat.seatIndex;
    }
  }
}

function afterGameMutation(room: Room): void {
  if (!room.game) {
    return;
  }
  for (const seat of room.seats) {
    const player = room.game.players[seat.seatIndex];
    if (!player) {
      continue;
    }
    seat.coins = player.coins;
    seat.connected = player.connected;
  }
  room.updatedAt = Date.now();
  void persist(room.code, "game.updated", toPublicGameState(room.game));
  broadcastGame(room);
  if (room.game.settlement) {
    io.to(room.code).emit("game.settlement", room.game.settlement);
  }
  scheduleBot(room);
  scheduleAutoTingDiscard(room);
}

function broadcastRoom(room: Room): void {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.roomCode !== room.code) {
      continue;
    }
    socket.emit("room.snapshot", snapshotRoom(room, snapshotOptionsForSocket(socket)));
  }
  if (room.game) {
    broadcastGame(room);
  }
}

function broadcastGame(room: Room): void {
  if (!room.game) {
    return;
  }
  const publicState = toPublicGameState(room.game);
  const spectatorState = toPublicGameState(room.game, { revealHands: true });
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.roomCode !== room.code) {
      continue;
    }
    socket.emit("game.publicState", socket.data.role === "spectator" ? spectatorState : publicState);
    if (socket.data.role === "player") {
      const privateState = getPrivateState(room.game, requirePlayerSeatIndex(socket));
      socket.emit("game.privateState", privateState);
      socket.emit("game.actionRequired", privateState.legalActions);
    }
  }
}

function emitFullState(room: Room, socketId: string): void {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) {
    return;
  }
  socket.emit("room.snapshot", snapshotRoom(room, snapshotOptionsForSocket(socket)));
  if (room.game) {
    socket.emit("game.publicState", gameStateForSocket(room.game, socket));
    if (socket.data.role === "player") {
      const privateState = getPrivateState(room.game, requirePlayerSeatIndex(socket));
      socket.emit("game.privateState", privateState);
      socket.emit("game.actionRequired", privateState.legalActions);
    }
  }
}

function scheduleBot(room: Room): void {
  if (room.botTimer) {
    return;
  }
  room.botTimer = setTimeout(() => {
    delete room.botTimer;
    void runBotStep(room);
  }, 450);
}

function scheduleAutoTingDiscard(room: Room): void {
  if (room.autoTingTimer || !room.game || room.game.phase !== "playing") {
    return;
  }

  const currentSeat = room.game.currentSeat;
  const seat = room.seats[currentSeat];
  const player = room.game.players[currentSeat];
  if (!seat || seat.isBot || !player?.declaredTing || !player.drawnTileId) {
    return;
  }

  if (getPrivateState(room.game, currentSeat).legalActions.some((action) => action.type === "win")) {
    return;
  }

  room.autoTingTimer = setTimeout(() => {
    delete room.autoTingTimer;
    if (!room.game) {
      return;
    }
    const seatIndex = room.game.currentSeat;
    if (autoTingDiscardIfNeeded(room.game, seatIndex)) {
      void persist(room.code, "game.autoTingDiscard", { seatIndex });
      afterGameMutation(room);
    }
  }, 700);
}

async function runBotStep(room: Room): Promise<void> {
  if (!room.game || room.game.phase === "settled" || room.game.phase === "draw") {
    return;
  }

  try {
    if (room.game.phase === "claiming" && room.game.claimWindow) {
      const botClaim = chooseRunnableBotClaim(room);
      if (!botClaim) {
        return;
      }
      const { seatIndex, action } = botClaim;
      applyClaim(room.game, seatIndex, action.type as "chow" | "pong" | "kong" | "win" | "pass", action.tileIds ?? []);
      await persist(room.code, "bot.claim", { seatIndex, type: action.type });
      afterGameMutation(room);
      return;
    }

    if (room.game.phase !== "playing") {
      return;
    }
    const seat = room.seats[room.game.currentSeat];
    if (!seat?.isBot) {
      return;
    }
    const actingSeat = room.game.currentSeat;
    const privateState = getPrivateState(room.game, actingSeat);
    const action = chooseBotTurnAction(privateState, buildBotDecisionContext(room.game, actingSeat));
    if (!action) {
      return;
    }
    if (action.type === "win") {
      applySelfDrawWin(room.game, actingSeat);
    } else if (action.type === "declareRiichi") {
      applyDeclareRiichi(room.game, actingSeat);
    } else if (action.type === "declareTing") {
      applyDeclareTing(room.game, actingSeat);
    } else if (action.type === "kong") {
      applyKong(room.game, actingSeat, action.tileIds ?? [], action.meldId);
    } else if (action.type === "discard" && action.tileId) {
      applyDiscard(room.game, actingSeat, action.tileId);
    }
    await persist(room.code, "bot.action", { seatIndex: actingSeat, type: action.type });
    afterGameMutation(room);
  } catch (error) {
    io.to(room.code).emit("game.error", { message: error instanceof Error ? error.message : "Bot action failed." });
  }
}

function chooseRunnableBotClaim(room: Room): { seatIndex: number; action: LegalAction } | undefined {
  const game = room.game;
  if (!game?.claimWindow) {
    return undefined;
  }

  const pendingBotOptions = game.claimWindow.options
    .filter((option) => room.seats[option.seatIndex]?.isBot && !game.claimWindow!.passedSeatIndices.includes(option.seatIndex))
    .sort((left, right) => {
      const priority = highestClaimPriority(right.actions) - highestClaimPriority(left.actions);
      if (priority !== 0) return priority;
      return seatDistance(game.claimWindow!.fromSeat, left.seatIndex) - seatDistance(game.claimWindow!.fromSeat, right.seatIndex);
    });

  for (const option of pendingBotOptions) {
    const privateState = getPrivateState(game, option.seatIndex);
    const context = buildBotDecisionContext(game, option.seatIndex);
    const action = chooseBotClaimAction(option.actions, privateState, context);
    if (action.type === "pass" || !hasPendingClaimBlocker(game, option.seatIndex, action.type)) {
      return { seatIndex: option.seatIndex, action };
    }
  }

  return undefined;
}

function buildBotDecisionContext(game: CoreGame, seatIndex: number): BotDecisionContext {
  const player = game.players[seatIndex]!;
  const visiblePlayers: BotVisiblePlayer[] = game.players.map((publicPlayer) => ({
    seatIndex: publicPlayer.seatIndex,
    discards: publicPlayer.discards,
    melds: publicPlayer.melds.map((meld) =>
      meld.concealed && publicPlayer.seatIndex !== seatIndex
        ? {
            ...meld,
            tiles: []
          }
        : meld
    ),
    declaredTing: publicPlayer.declaredTing,
    ...(publicPlayer.declaredRiichi ? { declaredRiichi: true } : {})
  }));
  const extraTiles: Tile[] = [];
  if (game.lastDiscard) {
    extraTiles.push(game.lastDiscard.tile);
  }
  if (game.claimWindow) {
    extraTiles.push(game.claimWindow.discard);
  }
  const visibleTileCounts = buildVisibleTileCounts({
    knownTiles: player.hand,
    visiblePlayers,
    ownSeatIndex: seatIndex,
    extraTiles
  });

  const context: BotDecisionContext = {
    mode: game.mode,
    difficulty: game.config.aiDifficulty,
    seatIndex,
    dealerSeat: game.dealerSeat,
    seatWind: player.wind,
    roundWind: game.roundWind,
    dealerStreak: game.dealerStreak,
    handId: game.handId,
    config: game.config,
    melds: player.melds,
    flowers: player.flowers,
    declaredTing: player.declaredTing,
    declaredHeavenTing: player.declaredHeavenTing,
    declaredEarthTing: player.declaredEarthTing,
    isAfterKong: Boolean(player.drawnTileId?.startsWith("supplement:")),
    isLastTile: game.wall.length <= (game.mode === "riichi" ? 14 : 16),
    isInitialWin: seatIndex === game.dealerSeat && !player.firstDiscardMade && !player.firstDrawMade,
    isFirstDrawWin: seatIndex !== game.dealerSeat && player.firstDrawMade && !player.firstDiscardMade,
    visiblePlayers,
    visibleTileCounts,
    wallCount: game.wall.length
  };
  if (game.claimWindow) {
    context.claimDiscard = game.claimWindow.discard;
    context.claimFromSeat = game.claimWindow.fromSeat;
  }
  return context;
}

function hasPendingClaimBlocker(game: CoreGame, seatIndex: number, claimType: LegalAction["type"]): boolean {
  if (!game.claimWindow) {
    return false;
  }
  const priority = claimPriority(claimType);
  for (const option of game.claimWindow.options) {
    if (option.seatIndex === seatIndex || game.claimWindow.passedSeatIndices.includes(option.seatIndex)) {
      continue;
    }
    const highest = highestClaimPriority(option.actions);
    if (highest > priority) {
      return true;
    }
    if (highest === priority && seatDistance(game.claimWindow.fromSeat, option.seatIndex) < seatDistance(game.claimWindow.fromSeat, seatIndex)) {
      return true;
    }
  }
  return false;
}

function highestClaimPriority(actions: LegalAction[]): number {
  return Math.max(...actions.map((action) => claimPriority(action.type)));
}

function claimPriority(type: LegalAction["type"]): number {
  if (type === "win") return 3;
  if (type === "pong" || type === "kong") return 2;
  if (type === "chow") return 1;
  return 0;
}

function snapshotRoom(room: Room, options: RoomSnapshotOptions = {}): RoomSnapshot {
  return {
    code: room.code,
    mode: room.mode,
    config: room.config,
    serverTime: Date.now(),
    hostPlayerId: room.hostPlayerId,
    seats: room.seats,
    ...(room.seatDraw ? { seatDraw: room.seatDraw } : {}),
    ...(room.game ? { game: toPublicGameState(room.game, options.revealHands ? { revealHands: true } : {}) } : {}),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  };
}

function toAdminRoomSource(room: Room): AdminRoomSource {
  const publicGame = room.game ? toPublicGameState(room.game) : undefined;
  let spectators = 0;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.roomCode === room.code && socket.data.role === "spectator") {
      spectators += 1;
    }
  }

  return {
    code: room.code,
    mode: room.mode,
    hostPlayerId: room.hostPlayerId,
    seats: room.seats,
    phase: room.seatDraw ? "seatDraw" : publicGame?.phase ?? "waiting",
    ...(publicGame ? { handId: publicGame.handId, wallCount: publicGame.wallCount } : {}),
    spectators,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  };
}

function disposeRoom(room: Room): void {
  for (const timer of room.disconnectTimers.values()) {
    clearTimeout(timer);
  }
  room.disconnectTimers.clear();
  if (room.seatDrawTimer) clearTimeout(room.seatDrawTimer);
  if (room.botTimer) clearTimeout(room.botTimer);
  if (room.autoTingTimer) clearTimeout(room.autoTingTimer);
}

function disconnectRoomClients(roomCode: string, reason: string | undefined): void {
  const message = reason ? `房間已由管理員關閉：${reason}` : "房間已由管理員關閉。";
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.roomCode !== roomCode) {
      continue;
    }
    socket.emit("room.closed", { message });
    socket.disconnect(true);
  }
}

function snapshotOptionsForSocket(socket: MahjongSocket): RoomSnapshotOptions {
  return socket.data.role === "spectator" ? { revealHands: true } : {};
}

function gameStateForSocket(game: CoreGame, socket: MahjongSocket) {
  return socket.data.role === "spectator" ? toPublicGameState(game, { revealHands: true }) : toPublicGameState(game);
}

function setConnected(room: Room, playerId: string, connected: boolean): void {
  const seat = room.seats.find((candidate) => candidate.playerId === playerId);
  if (!seat) {
    return;
  }
  seat.connected = connected;
  if (room.game) {
    room.game.players[seat.seatIndex]!.connected = connected;
  }
  room.updatedAt = Date.now();
}

function clearDisconnectTimer(room: Room, playerId: string): void {
  const timer = room.disconnectTimers.get(playerId);
  if (timer) {
    clearTimeout(timer);
    room.disconnectTimers.delete(playerId);
  }
}

function requirePlayerSeatIndex(socket: MahjongSocket): number {
  if (socket.data.role !== "player" || typeof socket.data.seatIndex !== "number") {
    throw new Error("觀戰者不能操作牌局。");
  }
  return socket.data.seatIndex;
}

async function handleSocketAction(socket: MahjongSocket, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    socket.emit("game.error", { message: error instanceof Error ? error.message : "Unknown server error." });
  }
}

async function handleGameAction(socket: MahjongSocket, type: string, action: () => void): Promise<void> {
  await handleSocketAction(socket, async () => {
    const seatIndex = requirePlayerSeatIndex(socket);
    action();
    await persist(socket.data.roomCode, type, { playerId: socket.data.playerId, seatIndex });
  });
}

function authenticateRequest(authorization: string | undefined): GuestSession | undefined {
  const token = authorization?.replace(/^Bearer\s+/i, "");
  return token ? sessions.get(token) : undefined;
}

function requireRoom(code: string): Room {
  const room = rooms.get(code);
  if (!room) {
    throw new Error("Room not found.");
  }
  return room;
}

function requireSeat(room: Room, playerId: string): PlayerSeat {
  const seat = room.seats.find((candidate) => candidate.playerId === playerId);
  if (!seat) {
    throw new Error("Player is not seated.");
  }
  return seat;
}

function requireGame(room: Room): CoreGame {
  if (!room.game) {
    throw new Error("Game has not started yet.");
  }
  return room.game;
}

async function persist(roomCode: string, type: string, payload: unknown): Promise<void> {
  await eventStore.append({
    id: `event_${nanoid(16)}`,
    roomCode,
    type,
    payload,
    createdAt: Date.now()
  });
}

function createRoomCode(): string {
  let code = "";
  do {
    code = nanoid(6).replace(/[-_]/g, "A").toUpperCase();
  } while (rooms.has(code));
  return code;
}
