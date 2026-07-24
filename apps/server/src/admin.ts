import { timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type {
  AdminAuditEntry,
  AdminDashboardResponse,
  AdminRoomPhase,
  AdminRoomSummary,
  GameMode,
  PlayerSeat
} from "@taiwan-mahjong/shared";

export const ADMIN_COOKIE_NAME = "mahjong_admin_session";
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_MAX_LOGIN_FAILURES = 5;

interface AdminSession {
  expiresAt: number;
}

interface LoginFailures {
  count: number;
  windowStartedAt: number;
  blockedUntil?: number;
}

export type AdminLoginResult =
  | { status: "ok"; token: string; expiresAt: number }
  | { status: "unconfigured" }
  | { status: "invalid" }
  | { status: "rateLimited"; retryAfterSeconds: number };

interface AdminSessionManagerOptions {
  sessionTtlMs?: number;
  loginWindowMs?: number;
  maxLoginFailures?: number;
  createToken?: () => string;
}

export class AdminSessionManager {
  readonly configured: boolean;

  private readonly password: string;
  private readonly sessionTtlMs: number;
  private readonly loginWindowMs: number;
  private readonly maxLoginFailures: number;
  private readonly createToken: () => string;
  private readonly sessions = new Map<string, AdminSession>();
  private readonly failures = new Map<string, LoginFailures>();

  constructor(password: string | undefined, options: AdminSessionManagerOptions = {}) {
    this.password = password ?? "";
    this.configured = this.password.length > 0;
    this.sessionTtlMs = options.sessionTtlMs ?? ADMIN_SESSION_TTL_MS;
    this.loginWindowMs = options.loginWindowMs ?? ADMIN_LOGIN_WINDOW_MS;
    this.maxLoginFailures = options.maxLoginFailures ?? ADMIN_MAX_LOGIN_FAILURES;
    this.createToken = options.createToken ?? (() => `admin_${nanoid(32)}`);
  }

  login(candidate: string, clientKey: string, now = Date.now()): AdminLoginResult {
    if (!this.configured) {
      return { status: "unconfigured" };
    }

    const failure = this.failures.get(clientKey);
    if (failure?.blockedUntil && failure.blockedUntil > now) {
      return {
        status: "rateLimited",
        retryAfterSeconds: Math.max(1, Math.ceil((failure.blockedUntil - now) / 1000))
      };
    }

    if (!secureStringEqual(candidate, this.password)) {
      return this.recordFailure(clientKey, now);
    }

    this.failures.delete(clientKey);
    const token = this.createToken();
    const expiresAt = now + this.sessionTtlMs;
    this.sessions.set(token, { expiresAt });
    return { status: "ok", token, expiresAt };
  }

  getExpiresAt(token: string | undefined, now = Date.now()): number | undefined {
    if (!token) {
      return undefined;
    }
    const session = this.sessions.get(token);
    if (!session) {
      return undefined;
    }
    if (session.expiresAt <= now) {
      this.sessions.delete(token);
      return undefined;
    }
    return session.expiresAt;
  }

  logout(token: string | undefined): void {
    if (token) {
      this.sessions.delete(token);
    }
  }

  private recordFailure(clientKey: string, now: number): AdminLoginResult {
    const previous = this.failures.get(clientKey);
    const insideWindow = previous && now - previous.windowStartedAt < this.loginWindowMs;
    const count = insideWindow ? previous.count + 1 : 1;
    const windowStartedAt = insideWindow ? previous.windowStartedAt : now;

    if (count >= this.maxLoginFailures) {
      const blockedUntil = now + this.loginWindowMs;
      this.failures.set(clientKey, { count, windowStartedAt, blockedUntil });
      return {
        status: "rateLimited",
        retryAfterSeconds: Math.ceil(this.loginWindowMs / 1000)
      };
    }

    this.failures.set(clientKey, { count, windowStartedAt });
    return { status: "invalid" };
  }
}

export interface AdminRoomSource {
  code: string;
  mode: GameMode;
  hostPlayerId: string;
  seats: PlayerSeat[];
  phase: AdminRoomPhase;
  handId?: string;
  wallCount?: number;
  spectators: number;
  createdAt: number;
  updatedAt: number;
}

export function buildAdminDashboard(options: {
  rooms: AdminRoomSource[];
  recentActions: AdminAuditEntry[];
  startedAt: number;
  persistence: "memory" | "postgres";
  now?: number;
}): AdminDashboardResponse {
  const now = options.now ?? Date.now();
  const roomSummaries = options.rooms
    .map(toAdminRoomSummary)
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return {
    generatedAt: now,
    server: {
      startedAt: options.startedAt,
      uptimeSeconds: Math.max(0, Math.floor((now - options.startedAt) / 1000)),
      persistence: options.persistence
    },
    totals: {
      rooms: roomSummaries.length,
      activeGames: roomSummaries.filter((room) => room.phase === "playing" || room.phase === "claiming").length,
      humanPlayers: sum(roomSummaries, (room) => room.humanPlayers),
      bots: sum(roomSummaries, (room) => room.bots),
      connectedPlayers: sum(roomSummaries, (room) => room.connectedPlayers),
      spectators: sum(roomSummaries, (room) => room.spectators),
      taiwanRooms: roomSummaries.filter((room) => room.mode === "taiwan").length,
      riichiRooms: roomSummaries.filter((room) => room.mode === "riichi").length
    },
    rooms: roomSummaries,
    recentActions: options.recentActions.slice(0, 30)
  };
}

function toAdminRoomSummary(room: AdminRoomSource): AdminRoomSummary {
  const humanSeats = room.seats.filter((seat) => seat.playerId && !seat.isBot);
  const botSeats = room.seats.filter((seat) => seat.isBot);

  return {
    code: room.code,
    mode: room.mode,
    phase: room.phase,
    seats: room.seats.map((seat) => ({
      seatIndex: seat.seatIndex,
      wind: seat.wind,
      ...(seat.name ? { name: seat.name } : {}),
      isBot: Boolean(seat.isBot),
      isHost: seat.playerId === room.hostPlayerId,
      connected: seat.connected,
      ready: seat.ready,
      coins: seat.coins
    })),
    humanPlayers: humanSeats.length,
    bots: botSeats.length,
    connectedPlayers: humanSeats.filter((seat) => seat.connected).length,
    spectators: room.spectators,
    ...(room.handId ? { handId: room.handId } : {}),
    ...(typeof room.wallCount === "number" ? { wallCount: room.wallCount } : {}),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  };
}

function sum<T>(values: T[], select: (value: T) => number): number {
  return values.reduce((total, value) => total + select(value), 0);
}

function secureStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    timingSafeEqual(rightBuffer, rightBuffer);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
