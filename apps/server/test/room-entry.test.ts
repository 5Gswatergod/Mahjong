import type { PlayerSeat } from "@taiwan-mahjong/shared";
import { describe, expect, it } from "vitest";
import { resolveRoomEntryRole } from "../src/room-entry.js";

function seats(playerIds: Array<string | undefined>): PlayerSeat[] {
  return playerIds.map((playerId, seatIndex) => ({
    seatIndex,
    wind: (["east", "south", "west", "north"] as const)[seatIndex]!,
    ...(playerId ? { playerId } : {}),
    coins: 10_000,
    ready: false,
    connected: false
  }));
}

describe("room entry role", () => {
  it("lets a new guest take an available seat", () => {
    expect(resolveRoomEntryRole({ seats: seats(["host", undefined, undefined, undefined]), seatDrawActive: false }, "guest")).toBe("player");
  });

  it("routes a new guest to spectator mode when every seat is occupied", () => {
    expect(resolveRoomEntryRole({ seats: seats(["host", "p2", "p3", "p4"]), seatDrawActive: false }, "guest")).toBe("spectator");
  });

  it("routes a new guest to spectator mode while seat draw is active", () => {
    expect(resolveRoomEntryRole({ seats: seats(["host", undefined, undefined, undefined]), seatDrawActive: true }, "guest")).toBe("spectator");
  });

  it("allows an existing seated player to reconnect even when the room is full", () => {
    expect(resolveRoomEntryRole({ seats: seats(["host", "p2", "p3", "p4"]), seatDrawActive: true }, "p3")).toBe("player");
  });
});
