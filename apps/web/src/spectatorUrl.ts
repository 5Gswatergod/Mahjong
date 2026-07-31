const roomPathPattern = /^\/room\/([a-z0-9]{4,8})\/?$/i;
const spectatorPathPattern = /^\/spectate\/([a-z0-9]{4,8})\/?$/i;

export type RoomEntryIntent = "auto" | "spectator";

export interface RoomEntryTarget {
  roomCode: string;
  intent: RoomEntryIntent;
}

export function readRoomEntryTarget(pathname: string): RoomEntryTarget | null {
  const roomCode = roomPathPattern.exec(pathname)?.[1]?.toUpperCase();
  if (roomCode) {
    return { roomCode, intent: "auto" };
  }
  const spectatorCode = readSpectatorRoomCode(pathname);
  return spectatorCode ? { roomCode: spectatorCode, intent: "spectator" } : null;
}

export function buildRoomPath(roomCode: string): string {
  return `/room/${encodeURIComponent(roomCode.trim().toUpperCase())}`;
}

export function buildRoomUrl(origin: string, roomCode: string): string {
  return new URL(buildRoomPath(roomCode), origin).toString();
}

export function readSpectatorRoomCode(pathname: string): string | null {
  return spectatorPathPattern.exec(pathname)?.[1]?.toUpperCase() ?? null;
}

export function buildSpectatorPath(roomCode: string): string {
  return `/spectate/${encodeURIComponent(roomCode.trim().toUpperCase())}`;
}

export function buildSpectatorUrl(origin: string, roomCode: string): string {
  return new URL(buildSpectatorPath(roomCode), origin).toString();
}
