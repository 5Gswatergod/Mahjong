import type { PlayerSeat, RoomEntryRole } from "@taiwan-mahjong/shared";

interface RoomEntryState {
  seats: PlayerSeat[];
  seatDrawActive: boolean;
}

export function resolveRoomEntryRole(state: RoomEntryState, playerId: string): RoomEntryRole {
  if (state.seats.some((seat) => seat.playerId === playerId)) {
    return "player";
  }
  if (state.seatDrawActive || state.seats.every((seat) => seat.playerId)) {
    return "spectator";
  }
  return "player";
}
