const spectatorPathPattern = /^\/spectate\/([a-z0-9]{4,8})\/?$/i;

export function readSpectatorRoomCode(pathname: string): string | null {
  return spectatorPathPattern.exec(pathname)?.[1]?.toUpperCase() ?? null;
}

export function buildSpectatorPath(roomCode: string): string {
  return `/spectate/${encodeURIComponent(roomCode.trim().toUpperCase())}`;
}

export function buildSpectatorUrl(origin: string, roomCode: string): string {
  return new URL(buildSpectatorPath(roomCode), origin).toString();
}
