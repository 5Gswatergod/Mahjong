import { describe, expect, it } from "vitest";
import type { Meld, PlayerSeat, Tile } from "@taiwan-mahjong/shared";
import {
  applySelfDrawWin,
  buildWall,
  calculateScore,
  canWin,
  createGame,
  createTileFromKey,
  decomposeWinningHand,
  getWinningTiles,
  tileKey
} from "../src/index.js";

function tile(key: string, copy: number): Tile {
  return createTileFromKey(key, copy);
}

function tiles(keys: string[]): Tile[] {
  const seen = new Map<string, number>();
  return keys.map((key) => {
    const copy = seen.get(key) ?? 0;
    seen.set(key, copy + 1);
    return tile(key, copy);
  });
}

function seats(): PlayerSeat[] {
  return ["east", "south", "west", "north"].map((wind, seatIndex) => ({
    seatIndex,
    wind: wind as PlayerSeat["wind"],
    playerId: `p${seatIndex}`,
    name: `P${seatIndex}`,
    coins: 10000,
    ready: true,
    connected: true
  }));
}

describe("tiles", () => {
  it("builds a unique 144 tile Taiwan mahjong wall", () => {
    const wall = buildWall();
    expect(wall).toHaveLength(144);
    expect(new Set(wall.map((candidate) => candidate.id)).size).toBe(144);
    expect(wall.filter((candidate) => candidate.kind === "flower")).toHaveLength(8);
  });
});

describe("winning hand detection", () => {
  it("decomposes a five-meld-and-pair hand", () => {
    const hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "characters:7",
      "characters:8",
      "characters:9",
      "dots:2",
      "dots:3",
      "dots:4",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "wind:east",
      "wind:east"
    ]);

    expect(canWin(hand)).toBe(true);
    expect(decomposeWinningHand(hand)).toHaveLength(1);
  });

  it("finds winning tiles for a single-pair wait", () => {
    const hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "characters:7",
      "characters:8",
      "characters:9",
      "dots:2",
      "dots:3",
      "dots:4",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "wind:east"
    ]);

    expect(getWinningTiles(hand).map(tileKey)).toEqual(["wind:east"]);
  });
});

describe("scoring", () => {
  it("scores menqing self draw as three tai instead of double-counting", () => {
    const hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "characters:7",
      "characters:8",
      "characters:9",
      "dots:2",
      "dots:3",
      "dots:4",
      "bamboo:6",
      "bamboo:7",
      "bamboo:8",
      "wind:east",
      "wind:east"
    ]);

    const result = calculateScore(
      [
        { seatIndex: 0, wind: "east", hand, flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
        { seatIndex: 1, wind: "south", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
        { seatIndex: 2, wind: "west", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
        { seatIndex: 3, wind: "north", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false }
      ],
      { handId: "h1", dealerSeat: 1, roundWind: "east", dealerStreak: 0 },
      { winnerSeat: 0, winMode: "selfDraw", winningTile: hand.at(-1)! }
    );

    expect(result.patterns.some((pattern) => pattern.id === "menqing-self-draw")).toBe(true);
    expect(result.patterns.some((pattern) => pattern.id === "menqing")).toBe(false);
    expect(result.patterns.some((pattern) => pattern.id === "self-draw")).toBe(false);
  });

  it("scores big three dragons and half flush", () => {
    const hand = tiles([
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:8",
      "characters:8",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "dragon:green",
      "dragon:green",
      "dragon:green",
      "dragon:white",
      "dragon:white",
      "dragon:white",
      "wind:south",
      "wind:south",
      "wind:south"
    ]);

    const result = calculateScore(
      [
        { seatIndex: 0, wind: "east", hand, flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
        { seatIndex: 1, wind: "south", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
        { seatIndex: 2, wind: "west", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
        { seatIndex: 3, wind: "north", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false }
      ],
      { handId: "h2", dealerSeat: 0, roundWind: "east", dealerStreak: 1 },
      { winnerSeat: 0, winMode: "discard", winningTile: hand.at(-1)!, fromSeat: 1, responsibilitySeat: 1 }
    );

    expect(result.patterns.map((pattern) => pattern.id)).toContain("big-three-dragons");
    expect(result.patterns.map((pattern) => pattern.id)).toContain("half-flush");
    expect(result.patterns.map((pattern) => pattern.id)).not.toContain("all-honors");
    expect(result.payments[0]?.tai).toBeGreaterThan(result.baseTai);
  });
});

describe("engine", () => {
  it("deals dealer 17 non-flower tiles and other players 16", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    expect(game.players[0]?.hand).toHaveLength(17);
    expect(game.players.slice(1).every((player) => player.hand.length === 16)).toBe(true);
    expect(game.wall.length).toBeGreaterThanOrEqual(16);
  });

  it("settles a self draw and transfers entertainment coins", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const winningHand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "characters:7",
      "characters:8",
      "characters:9",
      "dots:2",
      "dots:3",
      "dots:4",
      "bamboo:6",
      "bamboo:7",
      "bamboo:8",
      "wind:east",
      "wind:east"
    ]);
    game.players[0]!.hand = winningHand;
    game.players[0]!.melds = [] as Meld[];

    applySelfDrawWin(game, 0);

    expect(game.phase).toBe("settled");
    expect(game.settlement?.winnerSeat).toBe(0);
    expect(game.players[0]!.coins).toBeGreaterThan(10000);
    expect(game.players[1]!.coins).toBeLessThan(10000);
  });
});
