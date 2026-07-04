import { describe, expect, it } from "vitest";
import type { PlayerSeat } from "@taiwan-mahjong/shared";
import { applySeatDrawResult, createSeatDrawResult, SEAT_DRAW_HOLD_MS, SEAT_DRAW_REVEAL_INTERVAL_MS } from "../src/seat-draw.js";

function seats(): PlayerSeat[] {
  return [
    {
      seatIndex: 0,
      wind: "east",
      playerId: "p0",
      name: "Host",
      coins: 10000,
      ready: true,
      connected: true
    },
    {
      seatIndex: 1,
      wind: "south",
      playerId: "p1",
      name: "Guest 1",
      coins: 10000,
      ready: true,
      connected: true
    },
    {
      seatIndex: 2,
      wind: "west",
      playerId: "p2",
      name: "Guest 2",
      coins: 10000,
      ready: true,
      connected: false
    },
    {
      seatIndex: 3,
      wind: "north",
      playerId: "bot_3",
      name: "電腦 4",
      isBot: true,
      coins: 10000,
      ready: true,
      connected: true
    }
  ];
}

describe("seat draw", () => {
  it("reveals four wind cards and seats players by the wind they draw", () => {
    const now = 10_000;
    const draw = createSeatDrawResult(seats(), { id: "draw_1", now, random: () => 0 });

    expect(draw.cards.map((card) => [card.playerId, card.wind, card.assignedSeatIndex])).toEqual([
      ["p0", "south", 1],
      ["p1", "west", 2],
      ["p2", "north", 3],
      ["bot_3", "east", 0]
    ]);
    expect(draw.cards.map((card) => card.revealedAt)).toEqual([
      now + SEAT_DRAW_REVEAL_INTERVAL_MS,
      now + SEAT_DRAW_REVEAL_INTERVAL_MS * 2,
      now + SEAT_DRAW_REVEAL_INTERVAL_MS * 3,
      now + SEAT_DRAW_REVEAL_INTERVAL_MS * 4
    ]);
    expect(draw.completeAt).toBe(now + SEAT_DRAW_REVEAL_INTERVAL_MS * 4 + SEAT_DRAW_HOLD_MS);

    const nextSeats = applySeatDrawResult(seats(), draw);

    expect(nextSeats.map((seat) => [seat.seatIndex, seat.wind, seat.playerId, seat.name])).toEqual([
      [0, "east", "bot_3", "電腦 4"],
      [1, "south", "p0", "Host"],
      [2, "west", "p1", "Guest 1"],
      [3, "north", "p2", "Guest 2"]
    ]);
    expect(nextSeats[0]?.isBot).toBe(true);
    expect(nextSeats.every((seat) => !seat.ready)).toBe(true);
    expect(nextSeats[3]?.connected).toBe(false);
  });

  it("requires four occupied seats", () => {
    const partialSeats = seats();
    delete partialSeats[2]!.playerId;

    expect(() => createSeatDrawResult(partialSeats, { id: "draw_2", now: 0 })).toThrow("抓位需要四位玩家都入桌。");
  });
});
