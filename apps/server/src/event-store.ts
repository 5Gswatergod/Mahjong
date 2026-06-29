import process from "node:process";
import { Pool, type PoolConfig } from "pg";

export interface PersistedEvent {
  id: string;
  roomCode: string;
  type: string;
  payload: unknown;
  createdAt: number;
}

export interface EventStore {
  init(): Promise<void>;
  append(event: PersistedEvent): Promise<void>;
}

export class MemoryEventStore implements EventStore {
  readonly events: PersistedEvent[] = [];

  async init(): Promise<void> {
    return Promise.resolve();
  }

  async append(event: PersistedEvent): Promise<void> {
    this.events.push(event);
  }
}

export class PgEventStore implements EventStore {
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

export function resolveDatabaseConnection(): string | PoolConfig | undefined {
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
