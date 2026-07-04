import type { PlayerSeat, SeatDrawResult, Wind } from "@taiwan-mahjong/shared";
import { winds } from "@taiwan-mahjong/shared";

export const SEAT_DRAW_REVEAL_INTERVAL_MS = 700;
export const SEAT_DRAW_HOLD_MS = 1_000;

export function createSeatDrawResult(
  seats: PlayerSeat[],
  options: { id: string; now: number; random?: () => number }
): SeatDrawResult {
  const participants = seats.slice().sort((left, right) => left.seatIndex - right.seatIndex);
  if (participants.length !== winds.length || participants.some((seat) => !seat.playerId)) {
    throw new Error("抓位需要四位玩家都入桌。");
  }

  const deck = shuffleWinds(winds.slice(), options.random ?? Math.random);
  const cards = participants.map((seat, drawIndex) => {
    const wind = deck[drawIndex]!;
    return {
      drawIndex,
      playerId: seat.playerId!,
      name: seat.name ?? `玩家 ${seat.seatIndex + 1}`,
      ...(seat.isBot ? { isBot: true as const } : {}),
      wind,
      assignedSeatIndex: winds.indexOf(wind),
      revealedAt: options.now + (drawIndex + 1) * SEAT_DRAW_REVEAL_INTERVAL_MS
    };
  });

  return {
    id: options.id,
    startedAt: options.now,
    completeAt: options.now + cards.length * SEAT_DRAW_REVEAL_INTERVAL_MS + SEAT_DRAW_HOLD_MS,
    cards
  };
}

export function applySeatDrawResult(seats: PlayerSeat[], draw: SeatDrawResult): PlayerSeat[] {
  const seatsByPlayerId = new Map(seats.filter((seat) => seat.playerId).map((seat) => [seat.playerId!, seat]));
  const nextSeats = draw.cards
    .slice()
    .sort((left, right) => left.assignedSeatIndex - right.assignedSeatIndex)
    .map((card) => {
      const seat = seatsByPlayerId.get(card.playerId);
      if (!seat) {
        throw new Error("抓位結果與目前座位不一致。");
      }
      return {
        ...seat,
        seatIndex: card.assignedSeatIndex,
        wind: card.wind,
        ready: false
      };
    });

  if (nextSeats.length !== winds.length) {
    throw new Error("抓位結果不完整。");
  }

  return nextSeats;
}

function shuffleWinds(deck: Wind[], random: () => number): Wind[] {
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = deck[index]!;
    deck[index] = deck[swapIndex]!;
    deck[swapIndex] = current;
  }
  return deck;
}
