import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Pool, type PoolConfig } from "pg";
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
  autoRiichiDiscardIfNeeded,
  createGame,
  type CoreGame,
  getPrivateState,
  passExpiredClaimWindow,
  passExpiredTurn,
  toPublicGameState
} from "@taiwan-mahjong/game-core";
import {
  DEFAULT_GAME_CONFIG,
  type ClientToServerEvents,
  type GameMode,
  type LegalAction,
  type PlayerSeat,
  type PrivatePlayerState,
  type RoomSnapshot,
  type ServerToClientEvents,
  type SocketData,
  winds
} from "@taiwan-mahjong/shared";

declare module "@taiwan-mahjong/shared" {
  interface SocketData {
    playerId: string;
    roomCode: string;
    seatIndex: number;
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
  hostPlayerId: string;
  seats: PlayerSeat[];
  game?: CoreGame;
  createdAt: number;
  updatedAt: number;
  disconnectTimers: Map<string, NodeJS.Timeout>;
  botTimer?: NodeJS.Timeout;
  autoRiichiTimer?: NodeJS.Timeout;
}

interface PersistedEvent {
  id: string;
  roomCode: string;
  type: string;
  payload: unknown;
  createdAt: number;
}

interface EventStore {
  init(): Promise<void>;
  append(event: PersistedEvent): Promise<void>;
}

class MemoryEventStore implements EventStore {
  readonly events: PersistedEvent[] = [];

  async init(): Promise<void> {
    return Promise.resolve();
  }

  async append(event: PersistedEvent): Promise<void> {
    this.events.push(event);
  }
}

class PgEventStore implements EventStore {
  private readonly pool: Pool;

  constructor(connection: string | PoolConfig) {
    this.pool = typeof connection === "string" ? new Pool({ connectionString: connection }) : new Pool(connection);
  }

  async init(): Promise<void> {
    await this.pool.query(`
      create table if not exists mahjong_events (
        id text primary key,
        room_code text not null,
        type text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );
      create index if not exists mahjong_events_room_code_idx on mahjong_events(room_code);
    `);
  }

  async append(event: PersistedEvent): Promise<void> {
    await this.pool.query(
      "insert into mahjong_events (id, room_code, type, payload, created_at) values ($1, $2, $3, $4, to_timestamp($5 / 1000.0))",
      [event.id, event.roomCode, event.type, JSON.stringify(event.payload), event.createdAt]
    );
  }
}

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const port = Number(process.env.PORT ?? 4000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const staticDir = process.env.STATIC_DIR ?? path.resolve(currentDir, "../../web/dist");
const fastify = Fastify({ logger: true });
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(fastify.server, {
  cors: {
    origin: webOrigin,
    credentials: true
  }
});

const sessions = new Map<string, GuestSession>();
const rooms = new Map<string, Room>();
const databaseConnection = resolveDatabaseConnection();
const eventStore: EventStore = databaseConnection ? new PgEventStore(databaseConnection) : new MemoryEventStore();

await eventStore.init();
await fastify.register(cors, { origin: webOrigin, credentials: true });

fastify.get("/health", async () => ({
  ok: true,
  uptime: process.uptime(),
  rooms: rooms.size,
  persistence: databaseConnection ? "postgres" : "memory"
}));

fastify.get("/api/time", async () => ({
  serverTime: Date.now()
}));

fastify.post("/api/auth/guest", async (request) => {
  const body = z.object({ name: z.string().trim().min(1).max(20).optional() }).parse(request.body ?? {});
  const playerId = `player_${nanoid(10)}`;
  const name = body.name ?? `牌友${playerId.slice(-4)}`;
  const token = `guest_${nanoid(32)}`;
  const session = { playerId, name, token };
  sessions.set(token, session);
  return session;
});

fastify.post("/api/rooms", async (request, reply) => {
  const session = authenticateRequest(request.headers.authorization);
  if (!session) {
    return reply.code(401).send({ message: "Missing or invalid guest token." });
  }

  const body = z.object({ mode: z.enum(["taiwan", "riichi"]).default("taiwan") }).parse(request.body ?? {});
  const room = createRoom(session, body.mode);
  rooms.set(room.code, room);
  await persist(room.code, "room.created", { hostPlayerId: session.playerId, mode: room.mode });
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

  joinRoom(room, session);
  await persist(room.code, "room.joined", { playerId: session.playerId });
  broadcastRoom(room);
  return snapshotRoom(room);
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
    prefix: "/"
  });

  fastify.setNotFoundHandler((request, reply) => {
    const requestPath = request.url.split("?")[0] ?? "/";
    if (requestPath === "/api" || requestPath.startsWith("/api/") || requestPath.startsWith("/socket.io")) {
      return reply.code(404).send({ message: "Not found." });
    }

    if (request.headers.accept?.includes("text/html")) {
      return reply.sendFile("index.html");
    }

    return reply.code(404).send({ message: "Not found." });
  });
}

io.use((socket, next) => {
  const token = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : "";
  const roomCode = typeof socket.handshake.auth.roomCode === "string" ? socket.handshake.auth.roomCode.toUpperCase() : "";
  const session = sessions.get(token);
  const room = rooms.get(roomCode);
  if (!session || !room) {
    next(new Error("Invalid socket auth."));
    return;
  }
  const seat = room.seats.find((candidate) => candidate.playerId === session.playerId);
  if (!seat) {
    next(new Error("Player is not seated in this room."));
    return;
  }
  socket.data.playerId = session.playerId;
  socket.data.roomCode = room.code;
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
  clearDisconnectTimer(room, socket.data.playerId);
  setConnected(room, socket.data.playerId, true);
  socket.emit("connection.recovered", { roomCode: room.code, seatIndex: socket.data.seatIndex });
  emitFullState(room, socket.data.seatIndex, socket.id);
  broadcastRoom(room);

  socket.on("room.ready", async ({ ready }) => {
    await handleSocketAction(socket, async () => {
      const currentRoom = requireRoom(socket.data.roomCode);
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
      const seat = requireSeat(currentRoom, socket.data.playerId);
      seat.ready = false;
      seat.connected = false;
      if (currentRoom.game) {
        currentRoom.game.players[seat.seatIndex]!.connected = false;
      }
      await persist(currentRoom.code, "room.left", { playerId: socket.data.playerId });
      broadcastRoom(currentRoom);
      socket.leave(currentRoom.code);
    });
  });

  socket.on("game.discard", async ({ tileId }) => {
    await handleGameAction(socket, "game.discard", () => {
      const currentRoom = requireRoom(socket.data.roomCode);
      applyDiscard(requireGame(currentRoom), socket.data.seatIndex, tileId);
      afterGameMutation(currentRoom);
    });
  });

  socket.on("game.claim", async ({ type, tileIds }) => {
    await handleGameAction(socket, "game.claim", () => {
      const currentRoom = requireRoom(socket.data.roomCode);
      const currentGame = requireGame(currentRoom);
      if (type === "win" && currentGame.phase === "playing") {
        applySelfDrawWin(currentGame, socket.data.seatIndex);
      } else {
        applyClaim(currentGame, socket.data.seatIndex, type, tileIds ?? []);
      }
      afterGameMutation(currentRoom);
    });
  });

  socket.on("game.kong", async ({ tileIds, meldId }) => {
    await handleGameAction(socket, "game.kong", () => {
      const currentRoom = requireRoom(socket.data.roomCode);
      applyKong(requireGame(currentRoom), socket.data.seatIndex, tileIds, meldId);
      afterGameMutation(currentRoom);
    });
  });

  socket.on("game.declareTing", async () => {
    await handleGameAction(socket, "game.declareTing", () => {
      const currentRoom = requireRoom(socket.data.roomCode);
      applyDeclareTing(requireGame(currentRoom), socket.data.seatIndex);
      afterGameMutation(currentRoom);
    });
  });

  socket.on("game.declareRiichi", async () => {
    await handleGameAction(socket, "game.declareRiichi", () => {
      const currentRoom = requireRoom(socket.data.roomCode);
      applyDeclareRiichi(requireGame(currentRoom), socket.data.seatIndex);
      afterGameMutation(currentRoom);
    });
  });

  socket.on("game.resync", () => {
    emitFullState(room, socket.data.seatIndex, socket.id);
  });

  socket.on("disconnect", () => {
    const currentRoom = rooms.get(socket.data.roomCode);
    if (!currentRoom) {
      return;
    }
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
          autoDiscardIfNeeded(lateRoom.game, socket.data.seatIndex);
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

function createRoom(session: GuestSession, mode: GameMode): Room {
  const code = createRoomCode();
  const now = Date.now();
  const initialCoins = mode === "riichi" ? 25000 : DEFAULT_GAME_CONFIG.initialCoins;
  return {
    code,
    mode,
    hostPlayerId: session.playerId,
    seats: [
      {
        seatIndex: 0,
        wind: "east",
        playerId: session.playerId,
        name: session.name,
        coins: initialCoins,
        ready: false,
        connected: false
      },
      ...winds.slice(1).map((wind, offset) => ({
        seatIndex: offset + 1,
        wind,
        coins: initialCoins,
        ready: false,
        connected: false
      }))
    ],
    createdAt: now,
    updatedAt: now,
    disconnectTimers: new Map()
  };
}

function joinRoom(room: Room, session: GuestSession): PlayerSeat {
  const existing = room.seats.find((seat) => seat.playerId === session.playerId);
  if (existing) {
    return existing;
  }
  const seat = room.seats.find((candidate) => !candidate.playerId);
  if (!seat) {
    throw new Error("Room is full.");
  }
  seat.playerId = session.playerId;
  seat.name = session.name;
  seat.coins = room.mode === "riichi" ? 25000 : DEFAULT_GAME_CONFIG.initialCoins;
  seat.ready = false;
  seat.connected = false;
  room.updatedAt = Date.now();
  return seat;
}

function addBotToRoom(room: Room, requesterPlayerId: string, seatIndex: number): PlayerSeat {
  if (requesterPlayerId !== room.hostPlayerId) {
    throw new Error("Only the host can add computer players.");
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
  seat.coins = room.mode === "riichi" ? 25000 : DEFAULT_GAME_CONFIG.initialCoins;
  room.updatedAt = Date.now();
  return seat;
}

function clearSeatInRoom(room: Room, requesterPlayerId: string, seatIndex: number): PlayerSeat {
  if (requesterPlayerId !== room.hostPlayerId) {
    throw new Error("只有房主可以換人。");
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
  seat.coins = room.mode === "riichi" ? 25000 : DEFAULT_GAME_CONFIG.initialCoins;
  room.updatedAt = Date.now();
  return seat;
}

function detachPlayerSockets(room: Room, playerId: string, message: string): void {
  for (const client of io.sockets.sockets.values()) {
    if (client.data.roomCode !== room.code || client.data.playerId !== playerId) {
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
  if (room.game && room.game.phase !== "settled" && room.game.phase !== "draw") {
    return;
  }

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
  room.game = createGame(room.seats, { mode: room.mode, dealerSeat, roundWind, roundIndex, dealerStreak });
  for (const seat of room.seats) {
    seat.ready = false;
  }
  room.updatedAt = Date.now();
  void persist(room.code, "game.started", { handId: room.game.handId, dealerSeat, dealerStreak });
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
  scheduleAutoRiichiDiscard(room);
}

function broadcastRoom(room: Room): void {
  io.to(room.code).emit("room.snapshot", snapshotRoom(room));
  if (room.game) {
    broadcastGame(room);
  }
}

function broadcastGame(room: Room): void {
  if (!room.game) {
    return;
  }
  const publicState = toPublicGameState(room.game);
  io.to(room.code).emit("game.publicState", publicState);
  for (const seat of room.seats) {
    if (!seat.playerId) {
      continue;
    }
    const sockets = [...io.sockets.sockets.values()].filter(
      (socket) => socket.data.roomCode === room.code && socket.data.playerId === seat.playerId
    );
    for (const socket of sockets) {
      const privateState = getPrivateState(room.game, seat.seatIndex);
      socket.emit("game.privateState", privateState);
      socket.emit("game.actionRequired", privateState.legalActions);
    }
  }
}

function emitFullState(room: Room, seatIndex: number, socketId: string): void {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) {
    return;
  }
  socket.emit("room.snapshot", snapshotRoom(room));
  if (room.game) {
    socket.emit("game.publicState", toPublicGameState(room.game));
    const privateState = getPrivateState(room.game, seatIndex);
    socket.emit("game.privateState", privateState);
    socket.emit("game.actionRequired", privateState.legalActions);
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

function scheduleAutoRiichiDiscard(room: Room): void {
  if (room.autoRiichiTimer || !room.game || room.game.mode !== "riichi" || room.game.phase !== "playing") {
    return;
  }

  const currentSeat = room.game.currentSeat;
  const seat = room.seats[currentSeat];
  const player = room.game.players[currentSeat];
  if (!seat || seat.isBot || !player?.declaredRiichi || !player.drawnTileId) {
    return;
  }

  if (getPrivateState(room.game, currentSeat).legalActions.some((action) => action.type === "win")) {
    return;
  }

  room.autoRiichiTimer = setTimeout(() => {
    delete room.autoRiichiTimer;
    if (!room.game) {
      return;
    }
    const seatIndex = room.game.currentSeat;
    if (autoRiichiDiscardIfNeeded(room.game, seatIndex)) {
      void persist(room.code, "game.autoRiichiDiscard", { seatIndex });
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
      const option = room.game.claimWindow.options.find((candidate) => room.seats[candidate.seatIndex]?.isBot);
      if (!option) {
        return;
      }
      const action = chooseBotClaimAction(option.actions);
      applyClaim(room.game, option.seatIndex, action.type as "chow" | "pong" | "kong" | "win" | "pass", action.tileIds ?? []);
      await persist(room.code, "bot.claim", { seatIndex: option.seatIndex, type: action.type });
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
    const privateState = getPrivateState(room.game, room.game.currentSeat);
    const action = chooseBotTurnAction(privateState);
    if (!action) {
      return;
    }
    if (action.type === "win") {
      applySelfDrawWin(room.game, room.game.currentSeat);
    } else if (action.type === "declareRiichi") {
      applyDeclareRiichi(room.game, room.game.currentSeat);
    } else if (action.type === "discard" && action.tileId) {
      applyDiscard(room.game, room.game.currentSeat, action.tileId);
    }
    await persist(room.code, "bot.action", { seatIndex: room.game.currentSeat, type: action.type });
    afterGameMutation(room);
  } catch (error) {
    io.to(room.code).emit("game.error", { message: error instanceof Error ? error.message : "Bot action failed." });
  }
}

function chooseBotClaimAction(actions: LegalAction[]): LegalAction {
  return actions.find((action) => action.type === "win") ?? actions.find((action) => action.type === "pass") ?? actions[0]!;
}

function chooseBotTurnAction(privateState: PrivatePlayerState): LegalAction | undefined {
  const actions = privateState.legalActions;
  const win = actions.find((action) => action.type === "win");
  if (win) return win;
  const riichi = actions.find((action) => action.type === "declareRiichi");
  if (riichi) return riichi;
  const discards = actions.filter((action) => action.type === "discard" && action.tileId);
  if (discards.length === 0) {
    return actions.find((action) => action.type === "pass");
  }
  const handById = new Map(privateState.hand.map((tile) => [tile.id, tile]));
  return [...discards].sort((left, right) => {
    const leftTile = handById.get(left.tileId!);
    const rightTile = handById.get(right.tileId!);
    return discardScore(leftTile) - discardScore(rightTile);
  })[0];
}

function discardScore(tile: PrivatePlayerState["hand"][number] | undefined): number {
  if (!tile) return 0;
  if (tile.kind === "honor") return 1;
  if (!tile.rank) return 1;
  const terminalPenalty = tile.rank === 1 || tile.rank === 9 ? 0 : 2;
  const middleBonus = tile.rank >= 3 && tile.rank <= 7 ? 2 : 1;
  return terminalPenalty + middleBonus;
}

function resolveDatabaseConnection(): string | PoolConfig | undefined {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.POSTGRES_HOST;
  const database = process.env.POSTGRES_DB ?? process.env.POSTGRES_DATABASE;
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;

  if (!host || !database || !user || !password) {
    return undefined;
  }

  const port = process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : undefined;
  if (port !== undefined && !Number.isInteger(port)) {
    throw new Error("POSTGRES_PORT must be an integer.");
  }

  return {
    host,
    database,
    user,
    password,
    ...(port ? { port } : {}),
    ...(process.env.POSTGRES_SSL === "true"
      ? {
          ssl: {
            rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false"
          }
        }
      : {})
  };
}

function snapshotRoom(room: Room): RoomSnapshot {
  return {
    code: room.code,
    mode: room.mode,
    serverTime: Date.now(),
    hostPlayerId: room.hostPlayerId,
    seats: room.seats,
    ...(room.game ? { game: toPublicGameState(room.game) } : {}),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  };
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

async function handleSocketAction(socket: Parameters<Parameters<typeof io.on>[1]>[0], action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    socket.emit("game.error", { message: error instanceof Error ? error.message : "Unknown server error." });
  }
}

async function handleGameAction(socket: Parameters<Parameters<typeof io.on>[1]>[0], type: string, action: () => void): Promise<void> {
  await handleSocketAction(socket, async () => {
    action();
    await persist(socket.data.roomCode, type, { playerId: socket.data.playerId, seatIndex: socket.data.seatIndex });
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
