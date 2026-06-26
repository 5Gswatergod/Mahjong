import cors from "@fastify/cors";
import Fastify from "fastify";
import process from "node:process";
import { Pool } from "pg";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  applyClaim,
  applyDeclareTing,
  applyDiscard,
  applyKong,
  applySelfDrawWin,
  autoDiscardIfNeeded,
  createGame,
  type CoreGame,
  getPrivateState,
  passExpiredClaimWindow,
  toPublicGameState
} from "@taiwan-mahjong/game-core";
import {
  DEFAULT_GAME_CONFIG,
  type ClientToServerEvents,
  type PlayerSeat,
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
  hostPlayerId: string;
  seats: PlayerSeat[];
  game?: CoreGame;
  createdAt: number;
  updatedAt: number;
  disconnectTimers: Map<string, NodeJS.Timeout>;
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

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
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

const port = Number(process.env.PORT ?? 4000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const fastify = Fastify({ logger: true });
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(fastify.server, {
  cors: {
    origin: webOrigin,
    credentials: true
  }
});

const sessions = new Map<string, GuestSession>();
const rooms = new Map<string, Room>();
const eventStore: EventStore = process.env.DATABASE_URL
  ? new PgEventStore(process.env.DATABASE_URL)
  : new MemoryEventStore();

await eventStore.init();
await fastify.register(cors, { origin: webOrigin, credentials: true });

fastify.get("/health", async () => ({
  ok: true,
  uptime: process.uptime(),
  rooms: rooms.size,
  persistence: process.env.DATABASE_URL ? "postgres" : "memory"
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

  const room = createRoom(session);
  rooms.set(room.code, room);
  await persist(room.code, "room.created", { hostPlayerId: session.playerId });
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
    if (!room.game || room.game.phase !== "claiming") {
      continue;
    }
    const before = room.game.updatedAt;
    passExpiredClaimWindow(room.game);
    if (room.game.updatedAt !== before) {
      afterGameMutation(room);
    }
  }
}, 1000).unref();

await fastify.listen({ port, host: "0.0.0.0" });

function createRoom(session: GuestSession): Room {
  const code = createRoomCode();
  const now = Date.now();
  return {
    code,
    hostPlayerId: session.playerId,
    seats: [
      {
        seatIndex: 0,
        wind: "east",
        playerId: session.playerId,
        name: session.name,
        coins: DEFAULT_GAME_CONFIG.initialCoins,
        ready: false,
        connected: false
      },
      ...winds.slice(1).map((wind, offset) => ({
        seatIndex: offset + 1,
        wind,
        coins: DEFAULT_GAME_CONFIG.initialCoins,
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
  seat.coins = DEFAULT_GAME_CONFIG.initialCoins;
  seat.ready = false;
  seat.connected = false;
  room.updatedAt = Date.now();
  return seat;
}

function maybeStartHand(room: Room): void {
  const full = room.seats.every((seat) => seat.playerId);
  const allReady = room.seats.every((seat) => seat.ready);
  if (!full || !allReady) {
    return;
  }
  if (room.game && room.game.phase !== "settled" && room.game.phase !== "draw") {
    return;
  }

  const previous = room.game;
  const previousWinner = previous?.settlement?.winnerSeat;
  const previousDealer = previous?.dealerSeat ?? 0;
  const dealerSeat = previous && previousWinner === previousDealer ? previousDealer : previous ? (previousDealer + 1) % 4 : 0;
  const dealerStreak = previous && previousWinner === previousDealer ? previous.dealerStreak + 1 : 0;
  room.game = createGame(room.seats, { dealerSeat, dealerStreak });
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

function snapshotRoom(room: Room): RoomSnapshot {
  return {
    code: room.code,
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
