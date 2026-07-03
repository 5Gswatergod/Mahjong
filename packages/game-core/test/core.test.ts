import { describe, expect, it } from "vitest";
import type { Meld, PlayerSeat, Tile } from "@taiwan-mahjong/shared";
import {
  applyClaim,
  applyDeclareTing,
  applyDiscard,
  applyKong,
  applySelfDrawWin,
  applyDeclareRiichi,
  autoRiichiDiscardIfNeeded,
  buildWall,
  calculateScore,
  canWin,
  createGame,
  createTileFromKey,
  decomposeWinningHand,
  getPrivateState,
  getWinningTiles,
  passExpiredTurn,
  toPublicGameState,
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

  it("builds a 136 tile riichi wall with three red fives", () => {
    const wall = buildWall("riichi");
    expect(wall).toHaveLength(136);
    expect(new Set(wall.map((candidate) => candidate.id)).size).toBe(136);
    expect(wall.filter((candidate) => candidate.kind === "flower")).toHaveLength(0);
    expect(wall.filter((candidate) => candidate.red)).toHaveLength(3);
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
    expect(result.winningTile).toBe(hand.at(-1));
    expect(result.fromSeat).toBe(1);
    expect(result.responsibilitySeat).toBe(1);
    expect(result.payments[0]?.taiAdjustments).toEqual([
      { label: "莊家胡", tai: 1 },
      { label: "連1拉1", tai: 2 }
    ]);
  });

  it("labels dealer payment tai when winning from the dealer", () => {
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

    const result = calculateScore(
      [
        { seatIndex: 0, wind: "east", hand, flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
        { seatIndex: 1, wind: "south", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
        { seatIndex: 2, wind: "west", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
        { seatIndex: 3, wind: "north", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false }
      ],
      { handId: "dealer-payment", dealerSeat: 1, roundWind: "east", dealerStreak: 2 },
      { winnerSeat: 0, winMode: "discard", winningTile: hand.at(-1)!, fromSeat: 1, responsibilitySeat: 1 }
    );

    expect(result.payments[0]?.tai).toBe(result.baseTai + 5);
    expect(result.payments[0]?.taiAdjustments).toEqual([
      { label: "胡莊家", tai: 1 },
      { label: "連2拉2", tai: 4 }
    ]);
  });

  it("uses GameTower Taiwan tai values for major hands", () => {
    const allHonors = tiles([
      "wind:east",
      "wind:east",
      "wind:east",
      "wind:south",
      "wind:south",
      "wind:south",
      "wind:west",
      "wind:west",
      "wind:west",
      "wind:north",
      "wind:north",
      "wind:north",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "dragon:green",
      "dragon:green"
    ]);
    const cleanOneSuit = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "characters:4",
      "characters:5",
      "characters:6",
      "characters:7",
      "characters:8",
      "characters:9",
      "characters:9",
      "characters:9"
    ]);
    const fiveConcealedTriplets = tiles([
      "characters:1",
      "characters:1",
      "characters:1",
      "characters:2",
      "characters:2",
      "characters:2",
      "dots:3",
      "dots:3",
      "dots:3",
      "bamboo:4",
      "bamboo:4",
      "bamboo:4",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "wind:east",
      "wind:east"
    ]);

    const score = (hand: Tile[]) =>
      calculateScore(
        [
          { seatIndex: 0, wind: "east", hand, flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
          { seatIndex: 1, wind: "south", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
          { seatIndex: 2, wind: "west", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
          { seatIndex: 3, wind: "north", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false }
        ],
        { handId: "major", dealerSeat: 1, roundWind: "east", dealerStreak: 0 },
        { winnerSeat: 0, winMode: "discard", winningTile: hand.at(-1)!, fromSeat: 1, responsibilitySeat: 1 }
      );

    expect(score(allHonors).patterns.map((pattern) => pattern.id)).not.toContain("all-honors");
    expect(score(allHonors).patterns.find((pattern) => pattern.id === "clean-one-suit")?.tai).toBe(8);
    expect(score(cleanOneSuit).patterns.find((pattern) => pattern.id === "clean-one-suit")?.tai).toBe(8);
    expect(score(fiveConcealedTriplets).patterns.find((pattern) => pattern.id === "five-concealed-triplets")?.tai).toBe(8);
    expect(score(fiveConcealedTriplets).patterns.map((pattern) => pattern.id)).not.toContain("all-pongs");
    expect(score(fiveConcealedTriplets).patterns.map((pattern) => pattern.id)).not.toContain("menqing");
  });

  it("scores GameTower visible flower, visible wind, and no-honor-no-flower rules", () => {
    const noHonorHand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "characters:4",
      "characters:5",
      "characters:6",
      "characters:7",
      "characters:8",
      "characters:9",
      "characters:9",
      "characters:9"
    ]);
    const windHand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "characters:7",
      "characters:8",
      "characters:9",
      "dots:1",
      "dots:2",
      "dots:3",
      "wind:south",
      "wind:south",
      "wind:south",
      "dragon:red",
      "dragon:red"
    ]);
    const flowers = buildWall().filter((candidate) => candidate.kind === "flower").slice(0, 3);

    const score = (hand: Tile[], scoredFlowers: Tile[] = []) =>
      calculateScore(
        [
          { seatIndex: 0, wind: "east", hand, flowers: scoredFlowers, melds: [], declaredTing: false, declaredEarthTing: false },
          { seatIndex: 1, wind: "south", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
          { seatIndex: 2, wind: "west", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
          { seatIndex: 3, wind: "north", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false }
        ],
        { handId: "visible", dealerSeat: 1, roundWind: "east", dealerStreak: 0 },
        { winnerSeat: 0, winMode: "discard", winningTile: hand.at(-1)!, fromSeat: 1, responsibilitySeat: 1 }
      );

    expect(score(noHonorHand).patterns.find((pattern) => pattern.id === "ping-hu")?.tai).toBe(2);
    expect(score(noHonorHand).patterns.find((pattern) => pattern.id === "no-honors-no-flowers")?.tai).toBe(2);
    expect(score(noHonorHand, flowers).patterns.find((pattern) => pattern.id === "visible-flowers")?.tai).toBe(3);
    expect(score(windHand).patterns.find((pattern) => pattern.id === "wind-triplet-wind:south")?.tai).toBe(1);
  });

  it("scores GameTower kong and special ting rules", () => {
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
      "dots:2"
    ]);
    const exposedKongTiles = tiles(["dragon:red", "dragon:red", "dragon:red", "dragon:red"]);
    const concealedKongTiles = tiles(["wind:south", "wind:south", "wind:south", "wind:south"]);
    const melds: Meld[] = [
      { id: "meld_exposed", type: "exposedKong", tiles: exposedKongTiles, claimedTileId: exposedKongTiles[0]!.id, fromSeat: 1, concealed: false },
      { id: "meld_concealed", type: "concealedKong", tiles: concealedKongTiles, claimedTileId: concealedKongTiles[0]!.id, fromSeat: 0, concealed: true }
    ];

    const result = calculateScore(
      [
        { seatIndex: 0, wind: "east", hand, flowers: [], melds, declaredTing: true, declaredHeavenTing: true, declaredEarthTing: false },
        { seatIndex: 1, wind: "south", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
        { seatIndex: 2, wind: "west", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false },
        { seatIndex: 3, wind: "north", hand: [], flowers: [], melds: [], declaredTing: false, declaredEarthTing: false }
      ],
      { handId: "kong", dealerSeat: 0, roundWind: "east", dealerStreak: 0 },
      { winnerSeat: 0, winMode: "discard", winningTile: hand.at(-1)!, fromSeat: 1, responsibilitySeat: 1 }
    );

    expect(result.patterns.find((pattern) => pattern.id === "kong-meld_exposed")?.tai).toBe(1);
    expect(result.patterns.find((pattern) => pattern.id === "concealed-kong-meld_concealed")?.tai).toBe(2);
    expect(result.patterns.find((pattern) => pattern.id === "heaven-ting")?.tai).toBe(8);
    expect(result.patterns.map((pattern) => pattern.id)).not.toContain("declared-ting");
  });
});

describe("engine", () => {
  it("deals dealer 17 non-flower tiles and other players 16", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    expect(game.players[0]?.hand).toHaveLength(17);
    expect(game.players.slice(1).every((player) => player.hand.length === 16)).toBe(true);
    expect(game.wall.length).toBeGreaterThanOrEqual(16);
  });

  it("hides every concealed kong tile in public state", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const kongTiles = tiles(["characters:1", "characters:1", "characters:1", "characters:1"]);
    game.players[0]!.hand = kongTiles;

    applyKong(game, 0, kongTiles.map((candidate) => candidate.id));

    const publicMeld = toPublicGameState(game).players[0]!.melds[0]!;
    const privateMeld = getPrivateState(game, 0).privateMelds[0]!;
    expect(publicMeld.type).toBe("concealedKong");
    expect(publicMeld.tiles).toHaveLength(4);
    expect(publicMeld.tiles.every((candidate) => candidate.label === "暗")).toBe(true);
    expect(publicMeld.tiles.some((candidate) => candidate.suit || candidate.rank || candidate.wind || candidate.dragon)).toBe(false);
    expect(privateMeld.type).toBe("concealedKong");
    expect(privateMeld.tiles.map(tileKey)).toEqual(["characters:1", "characters:1", "characters:1", "characters:1"]);
  });

  it("replaces a drawn flower with exactly one supplement tile", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const discardTile = tile("dragon:white", 0);
    const flowerTile = buildWall().find((candidate) => candidate.kind === "flower" && candidate.flower === "plum")!;
    const nextLiveTile = tile("characters:9", 0);
    const supplementTile = tile("bamboo:9", 0);
    game.currentSeat = 0;
    game.players[0]!.hand = [discardTile];
    game.players.forEach((player) => {
      player.flowers = [];
    });
    game.players[1]!.hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "dots:1",
      "dots:2",
      "dots:3",
      "bamboo:1",
      "bamboo:2",
      "bamboo:3",
      "wind:east",
      "wind:south",
      "wind:west",
      "dragon:red"
    ]);
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];
    game.wall = [
      flowerTile,
      nextLiveTile,
      ...tiles([
        "characters:7",
        "characters:8",
        "dots:4",
        "dots:5",
        "dots:6",
        "bamboo:4",
        "bamboo:5",
        "bamboo:6",
        "dragon:green",
        "dragon:green",
        "dragon:white",
        "dragon:white",
        "wind:north",
        "wind:north",
        "wind:west",
        "wind:south"
      ]),
      supplementTile
    ];

    applyDiscard(game, 0, discardTile.id);

    expect(game.currentSeat).toBe(1);
    expect(game.players[1]!.flowers).toEqual([flowerTile]);
    expect(game.players[1]!.hand).toHaveLength(17);
    expect(game.players[1]!.hand.some((candidate) => candidate.id === supplementTile.id)).toBe(true);
    expect(game.players[1]!.hand.some((candidate) => candidate.id === nextLiveTile.id)).toBe(false);
    expect(game.players[1]!.drawnTileId).toBe(supplementTile.id);
    expect(game.wall[0]?.id).toBe(nextLiveTile.id);
  });

  it("publishes turn deadlines and server time for countdown display", () => {
    const before = Date.now();
    const game = createGame(seats(), { config: { autoDiscardMs: 9000 }, random: () => 0.42 });
    const publicState = toPublicGameState(game);

    expect(game.turnDeadlineAt).toBeGreaterThanOrEqual(before + 9000);
    expect(publicState.turnDeadlineAt).toBe(game.turnDeadlineAt);
    expect(publicState.serverTime).toBeGreaterThanOrEqual(before);
  });

  it("deals riichi hands, dora, and no flowers", () => {
    const game = createGame(seats(), { mode: "riichi", random: () => 0.42 });
    expect(game.mode).toBe("riichi");
    expect(game.players[0]?.hand).toHaveLength(14);
    expect(game.players.slice(1).every((player) => player.hand.length === 13)).toBe(true);
    expect(game.riichi?.doraIndicators).toHaveLength(1);
    expect(game.players.every((player) => player.flowers.length === 0)).toBe(true);
  });

  it("builds riichi private state without missing hule parameter fields", () => {
    const game = createGame(seats(), { mode: "riichi", random: () => 0.42 });
    const privateState = getPrivateState(game, 0);

    expect(privateState.hand).toHaveLength(14);
    expect(Array.isArray(privateState.legalActions)).toBe(true);
  });

  it("keeps the drawn tile at the right edge of the private hand", () => {
    const game = createGame(seats(), { random: () => 0.42 });
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
    const drawnTile = hand[0]!;
    game.players[0]!.hand = hand;
    game.players[0]!.drawnTileId = drawnTile.id;

    const privateState = getPrivateState(game, 0);

    expect(privateState.drawnTileId).toBe(drawnTile.id);
    expect(privateState.hand.at(-1)?.id).toBe(drawnTile.id);
  });

  it("does not allow a fake self draw immediately after claiming a pong", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const discardTile = tile("dragon:red", 2);
    game.currentSeat = 0;
    game.players[0]!.hand = [discardTile];
    game.players[1]!.hand = [
      ...tiles([
        "characters:1",
        "characters:2",
        "characters:3",
        "characters:4",
        "characters:5",
        "characters:6",
        "dots:1",
        "dots:2",
        "dots:3",
        "bamboo:1",
        "bamboo:2",
        "bamboo:3",
        "wind:east",
        "wind:east"
      ]),
      tile("dragon:red", 0),
      tile("dragon:red", 1)
    ];
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];
    const staleDrawnTile = tile("bamboo:9", 0);
    game.players[1]!.hand.push(staleDrawnTile);

    applyDiscard(game, 0, discardTile.id);
    const wallLengthAfterDiscard = game.wall.length;
    game.players[1]!.drawnTileId = staleDrawnTile.id;
    applyClaim(game, 1, "pong");

    const privateState = getPrivateState(game, 1);
    expect(game.currentSeat).toBe(1);
    expect(game.players[1]!.hand).toHaveLength(14);
    expect(game.players[1]!.drawnTileId).toBeUndefined();
    expect(game.wall).toHaveLength(wallLengthAfterDiscard);
    expect(privateState.drawnTileId).toBeUndefined();
    expect(privateState.hand).toHaveLength(14);
    expect(privateState.legalActions.some((action) => action.type === "win")).toBe(false);
    expect(privateState.legalActions.every((action) => action.type === "discard" || action.type === "declareTing")).toBe(true);
    expect(() => applySelfDrawWin(game, 1)).toThrow();

    const discardAfterPong = privateState.legalActions.find((action) => action.type === "discard" && action.tileId);
    expect(discardAfterPong?.tileId).toBeTruthy();
    applyDiscard(game, 1, discardAfterPong!.tileId!);
    expect(game.players[1]!.hand).toHaveLength(13);
    expect(game.players[1]!.drawnTileId).toBeUndefined();
    expect(game.currentSeat).toBe(2);
    expect(game.players[2]!.hand).toHaveLength(1);
    expect(game.players[2]!.drawnTileId).toBe(game.players[2]!.hand[0]!.id);
  });

  it("does not draw a tile after claiming a chow", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const discardTile = tile("characters:2", 2);
    const chowLeft = tile("characters:1", 0);
    const chowRight = tile("characters:3", 0);
    const staleDrawnTile = tile("bamboo:9", 0);
    game.currentSeat = 0;
    game.players[0]!.hand = [discardTile];
    game.players[1]!.hand = [
      chowLeft,
      chowRight,
      staleDrawnTile,
      ...tiles([
        "characters:4",
        "characters:5",
        "characters:6",
        "dots:1",
        "dots:2",
        "dots:3",
        "bamboo:1",
        "bamboo:2",
        "bamboo:3",
        "dragon:red",
        "dragon:red",
        "dragon:green",
        "dragon:green",
        "wind:east"
      ])
    ];
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];

    applyDiscard(game, 0, discardTile.id);
    const wallLengthAfterDiscard = game.wall.length;
    game.players[1]!.drawnTileId = staleDrawnTile.id;
    applyClaim(game, 1, "chow", [chowLeft.id, chowRight.id]);

    const privateState = getPrivateState(game, 1);
    expect(game.currentSeat).toBe(1);
    expect(game.players[1]!.hand).toHaveLength(14);
    expect(game.players[1]!.drawnTileId).toBeUndefined();
    expect(game.wall).toHaveLength(wallLengthAfterDiscard);
    expect(privateState.drawnTileId).toBeUndefined();
    expect(privateState.legalActions.some((action) => action.type === "win")).toBe(false);
    expect(() => applySelfDrawWin(game, 1)).toThrow();

    const discardAfterChow = privateState.legalActions.find((action) => action.type === "discard" && action.tileId);
    expect(discardAfterChow?.tileId).toBeTruthy();
    applyDiscard(game, 1, discardAfterChow!.tileId!);
    expect(game.players[1]!.hand).toHaveLength(13);
    expect(game.players[1]!.drawnTileId).toBeUndefined();
    expect(game.currentSeat).toBe(2);
    expect(game.players[2]!.hand).toHaveLength(1);
    expect(game.players[2]!.drawnTileId).toBe(game.players[2]!.hand[0]!.id);
  });

  it("places the ron tile and completed group at the right edge of the settlement hand", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const winningTile = tile("characters:3", 0);
    game.currentSeat = 0;
    game.players[0]!.hand = [winningTile];
    game.players[1]!.hand = tiles([
      "characters:1",
      "characters:2",
      "characters:4",
      "characters:5",
      "characters:6",
      "dots:1",
      "dots:2",
      "dots:3",
      "bamboo:1",
      "bamboo:2",
      "bamboo:3",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "wind:east",
      "wind:east"
    ]);
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];

    applyDiscard(game, 0, winningTile.id);
    applyClaim(game, 1, "win");

    const winnerHand = game.settlement?.winnerHand ?? [];
    expect(winnerHand.slice(-3).map(tileKey)).toEqual(["characters:1", "characters:2", "characters:3"]);
    expect(winnerHand.at(-1)?.id).toBe(winningTile.id);
  });

  it("reports tenpai discards without requiring a declared ting action", () => {
    const game = createGame(seats(), { random: () => 0.42 });
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
      "bamboo:9"
    ]);
    const discard = hand.at(-1)!;
    game.players[0]!.hand = hand;
    game.players[0]!.declaredTing = false;

    const privateState = getPrivateState(game, 0);

    expect(privateState.tingDiscardIds).toContain(discard.id);
    expect(privateState.tingHints.find((hint) => hint.discardTile.id === discard.id)?.winningTiles.map(tileKey)).toEqual(["wind:east"]);
  });

  it("offers Taiwan ting declaration when a legal post-declaration discard stays tenpai", () => {
    const game = createGame(seats(), { random: () => 0.42 });
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
      "bamboo:9"
    ]);
    game.players[0]!.hand = hand;

    const privateState = getPrivateState(game, 0);

    expect(privateState.legalActions.some((action) => action.type === "declareTing")).toBe(true);
  });

  it("auto-discards the best waiting tile when declaring Taiwan ting", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const hand = tiles([
      "characters:4",
      "characters:5",
      "characters:6",
      "dots:4",
      "dots:5",
      "dots:6",
      "bamboo:4",
      "bamboo:5",
      "bamboo:6",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "dragon:green",
      "dragon:green",
      "characters:1",
      "characters:2",
      "characters:3"
    ]);
    game.currentSeat = 0;
    game.players[0]!.hand = hand;
    game.players[1]!.hand = [];
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];

    applyDeclareTing(game, 0);

    expect(game.players[0]!.declaredTing).toBe(true);
    expect(tileKey(game.players[0]!.discards.at(-1)!)).toBe("characters:1");
    expect(game.currentSeat).toBe(1);
  });

  it("does not offer Taiwan ting declaration when the forced discard would break tenpai", () => {
    const game = createGame(seats(), { random: () => 0.42 });
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
      "bamboo:9"
    ]);
    game.players[0]!.hand = hand;
    game.players[0]!.drawnTileId = hand[0]!.id;

    const privateState = getPrivateState(game, 0);

    expect(privateState.tingDiscardIds).toContain(hand.at(-1)!.id);
    expect(privateState.legalActions.some((action) => action.type === "declareTing")).toBe(false);
  });

  it("does not offer Taiwan ting declaration in riichi mode", () => {
    const game = createGame(seats(), { mode: "riichi", random: () => 0.42 });
    game.players[0]!.hand = tiles([
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
      "wind:east",
      "wind:east"
    ]);

    const privateState = getPrivateState(game, 0);

    expect(privateState.legalActions.some((action) => action.type === "declareTing")).toBe(false);
  });

  it("auto-discards a drawn tile when declaring Taiwan ting", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const drawnTile = tile("bamboo:9", 0);
    game.currentSeat = 0;
    game.players[0]!.hand = [
      ...tiles([
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
      ]),
      drawnTile
    ];
    game.players[0]!.drawnTileId = drawnTile.id;
    game.players[1]!.hand = [];
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];
    game.wall = [
      tile("wind:north", 3),
      ...tiles([
        "characters:7",
        "characters:8",
        "characters:9",
        "dots:1",
        "dots:2",
        "dots:3",
        "dots:4",
        "dots:5",
        "dots:6",
        "bamboo:4",
        "bamboo:5",
        "bamboo:6",
        "dragon:red",
        "dragon:green",
        "dragon:white",
        "wind:south"
      ])
    ];

    applyDeclareTing(game, 0);

    expect(game.players[0]!.discards.at(-1)?.id).toBe(drawnTile.id);
    expect(game.currentSeat).toBe(1);
  });

  it("does not offer chow pong or exposed kong claims after Taiwan ting", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const discardTile = tile("dragon:red", 3);
    game.currentSeat = 0;
    game.players[0]!.hand = [discardTile];
    game.players[1]!.declaredTing = true;
    game.players[1]!.hand = tiles([
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "characters:1",
      "characters:4",
      "characters:7",
      "dots:1",
      "dots:4",
      "dots:7",
      "bamboo:1",
      "bamboo:4",
      "bamboo:7",
      "wind:east",
      "wind:south",
      "wind:west",
      "wind:north"
    ]);
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];
    game.wall = [
      tile("bamboo:9", 3),
      ...tiles([
        "characters:7",
        "characters:8",
        "characters:9",
        "dots:1",
        "dots:2",
        "dots:3",
        "dots:4",
        "dots:5",
        "dots:6",
        "bamboo:4",
        "bamboo:5",
        "bamboo:6",
        "dragon:green",
        "dragon:white",
        "wind:south",
        "wind:west"
      ])
    ];

    applyDiscard(game, 0, discardTile.id);

    expect(game.claimWindow).toBeUndefined();
    expect(game.phase).toBe("playing");
    expect(game.currentSeat).toBe(1);
  });

  it("blocks Taiwan ron and self draw after passing a winning discard until a passed hand", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const discardTile = tile("wind:east", 2);
    const selfDrawTile = tile("wind:east", 3);
    game.currentSeat = 0;
    game.wall = [
      selfDrawTile,
      ...tiles([
        "characters:7",
        "characters:8",
        "characters:9",
        "dots:1",
        "dots:2",
        "dots:3",
        "dots:4",
        "dots:5",
        "dots:6",
        "bamboo:4",
        "bamboo:5",
        "bamboo:6",
        "dragon:red",
        "dragon:green",
        "dragon:white",
        "wind:north"
      ])
    ];
    game.players[0]!.hand = [
      ...tiles([
        "characters:1",
        "characters:2",
        "characters:3",
        "characters:4",
        "characters:5",
        "characters:6",
        "dots:1",
        "dots:2",
        "dots:3",
        "bamboo:1",
        "bamboo:1",
        "bamboo:1",
        "bamboo:2",
        "bamboo:2",
        "bamboo:2",
        "dragon:white"
      ]),
      discardTile
    ];
    game.players[1]!.hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "dots:1",
      "dots:2",
      "dots:3",
      "bamboo:1",
      "bamboo:1",
      "bamboo:1",
      "bamboo:2",
      "bamboo:2",
      "bamboo:2",
      "wind:east"
    ]);

    applyDiscard(game, 0, discardTile.id);
    expect(game.claimWindow?.options.find((option) => option.seatIndex === 1)?.actions.some((action) => action.type === "win")).toBe(true);

    applyClaim(game, 1, "pass");
    const privateState = getPrivateState(game, 1);

    expect(game.currentSeat).toBe(1);
    expect(privateState.drawnTileId).toBe(selfDrawTile.id);
    expect(privateState.legalActions.some((action) => action.type === "win")).toBe(false);
  });

  it("allows riichi declaration for a closed tenpai hand", () => {
    const game = createGame(seats(), { mode: "riichi", random: () => 0.42 });
    game.players[0]!.hand = tiles([
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
      "wind:east",
      "wind:east"
    ]);

    applyDeclareRiichi(game, 0);

    expect(game.players[0]?.declaredRiichi).toBe(true);
    expect(game.players[0]?.coins).toBe(24000);
    expect(game.riichi?.riichiSticks).toBe(1);
  });

  it("blocks riichi ron while the player is discard-furiten", () => {
    const game = createGame(seats(), { mode: "riichi", random: () => 0.42 });
    const discardTile = tile("wind:east", 2);
    game.currentSeat = 0;
    game.players[0]!.hand = [
      ...tiles([
        "characters:1",
        "characters:2",
        "characters:3",
        "characters:4",
        "characters:5",
        "characters:6",
        "dots:1",
        "dots:2",
        "dots:3",
        "bamboo:1",
        "bamboo:2",
        "bamboo:3",
        "dragon:white"
      ]),
      discardTile
    ];
    game.players[1]!.hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "dots:7",
      "dots:8",
      "dots:9",
      "bamboo:1",
      "bamboo:1",
      "bamboo:1",
      "wind:east"
    ]);
    game.players[1]!.discards = [tile("wind:east", 1)];

    applyDiscard(game, 0, discardTile.id);

    const furitenClaim = game.claimWindow?.options.find((option) => option.seatIndex === 1);
    expect(furitenClaim?.actions.some((action) => action.type === "win")).not.toBe(true);
  });

  it("keeps the latest unclaimed discard visible after advancing the turn", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const discardTile = tile("dragon:white", 0);
    const nextDraw = tile("characters:9", 0);
    game.currentSeat = 0;
    game.wall = [
      nextDraw,
      ...tiles([
        "characters:7",
        "characters:8",
        "characters:9",
        "dots:1",
        "dots:2",
        "dots:3",
        "dots:4",
        "dots:5",
        "dots:6",
        "bamboo:4",
        "bamboo:5",
        "bamboo:6",
        "dragon:red",
        "dragon:green",
        "wind:north",
        "wind:south"
      ])
    ];
    game.players[0]!.hand = [discardTile];
    game.players[1]!.hand = [];
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];

    applyDiscard(game, 0, discardTile.id);

    expect(game.phase).toBe("playing");
    expect(game.currentSeat).toBe(1);
    expect(game.lastDiscard?.tile.id).toBe(discardTile.id);
  });

  it("settles a Taiwan exhaustive draw with a settlement payload", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const discardTile = tile("dragon:white", 0);
    game.currentSeat = 0;
    game.wall = game.wall.slice(0, 16);
    game.players[0]!.hand = [discardTile];
    game.players[1]!.hand = [];
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];

    applyDiscard(game, 0, discardTile.id);

    expect(game.phase).toBe("draw");
    expect(game.settlement?.winMode).toBe("draw");
    expect(game.settlement?.drawReason).toBe("荒牌流局");
  });

  it("waits through latency grace before auto-discarding an expired turn", () => {
    const game = createGame(seats(), { config: { autoDiscardMs: 1000, latencyGraceMs: 500 }, random: () => 0.42 });
    const discardTile = tile("dragon:white", 0);
    game.currentSeat = 0;
    game.turnDeadlineAt = 1000;
    game.wall = [
      tile("characters:9", 0),
      ...tiles([
        "characters:7",
        "characters:8",
        "characters:9",
        "dots:1",
        "dots:2",
        "dots:3",
        "dots:4",
        "dots:5",
        "dots:6",
        "bamboo:4",
        "bamboo:5",
        "bamboo:6",
        "dragon:red",
        "dragon:green",
        "wind:north",
        "wind:south"
      ])
    ];
    game.players[0]!.hand = [discardTile];
    game.players[1]!.hand = [];
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];

    passExpiredTurn(game, 1499);
    expect(game.players[0]!.discards).toHaveLength(0);
    expect(game.currentSeat).toBe(0);

    passExpiredTurn(game, 1500);
    expect(game.players[0]!.discards.at(-1)?.id).toBe(discardTile.id);
    expect(game.currentSeat).toBe(1);
  });

  it("offers added kong actions from an existing pong meld", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const pongTiles = tiles(["dragon:red", "dragon:red", "dragon:red"]);
    const addTile = tile("dragon:red", 3);
    game.players[0]!.hand = [
      addTile,
      ...tiles([
        "characters:1",
        "characters:2",
        "characters:3",
        "dots:1",
        "dots:2",
        "dots:3",
        "bamboo:1",
        "bamboo:2",
        "bamboo:3",
        "wind:east",
        "wind:south",
        "wind:west",
        "wind:north"
      ])
    ];
    game.players[0]!.melds = [{ id: "meld_pong_red", type: "pong", tiles: pongTiles, claimedTileId: pongTiles[0]!.id, fromSeat: 1, concealed: false }];

    const action = getPrivateState(game, 0).legalActions.find((candidate) => candidate.type === "kong" && candidate.meldId === "meld_pong_red");

    expect(action?.tileIds).toEqual([addTile.id]);
  });

  it("draws a supplement tile after claiming an exposed kong", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const discardTile = tile("dragon:red", 3);
    const supplementTile = tile("dots:9", 3);
    game.currentSeat = 0;
    game.players[0]!.hand = [discardTile];
    game.players[1]!.hand = [
      ...tiles(["dragon:red", "dragon:red", "dragon:red"]),
      ...tiles([
        "characters:1",
        "characters:2",
        "characters:3",
        "dots:1",
        "dots:2",
        "dots:3",
        "bamboo:1",
        "bamboo:2",
        "bamboo:3",
        "wind:east",
        "wind:south",
        "wind:west",
        "wind:north"
      ])
    ];
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];
    game.wall = [
      ...tiles([
        "characters:4",
        "characters:5",
        "characters:6",
        "characters:7",
        "characters:8",
        "characters:9",
        "dots:4",
        "dots:5",
        "dots:6",
        "bamboo:4",
        "bamboo:5",
        "bamboo:6",
        "dragon:green",
        "dragon:green",
        "dragon:white",
        "dragon:white"
      ]),
      supplementTile
    ];

    applyDiscard(game, 0, discardTile.id);
    const wallLengthAfterDiscard = game.wall.length;
    applyClaim(game, 1, "kong");

    expect(game.currentSeat).toBe(1);
    expect(game.players[1]!.melds.at(-1)?.type).toBe("exposedKong");
    expect(game.players[1]!.hand).toHaveLength(14);
    expect(game.players[1]!.drawnTileId).toBe(`supplement:${supplementTile.id}`);
    expect(game.players[1]!.hand.some((candidate) => candidate.id === supplementTile.id)).toBe(true);
    expect(game.wall).toHaveLength(wallLengthAfterDiscard - 1);
  });

  it("draws a supplement tile after declaring a concealed kong", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const kongTiles = tiles(["dragon:red", "dragon:red", "dragon:red", "dragon:red"]);
    const supplementTile = tile("dots:9", 3);
    game.currentSeat = 0;
    game.players[0]!.hand = [
      ...kongTiles,
      ...tiles([
        "characters:1",
        "characters:2",
        "characters:3",
        "characters:4",
        "characters:5",
        "characters:6",
        "dots:1",
        "dots:2",
        "dots:3",
        "bamboo:1",
        "bamboo:2",
        "bamboo:3",
        "wind:east"
      ])
    ];
    game.players[0]!.drawnTileId = kongTiles.at(-1)!.id;
    game.wall = [
      ...tiles([
        "characters:7",
        "characters:8",
        "characters:9",
        "dots:4",
        "dots:5",
        "dots:6",
        "bamboo:4",
        "bamboo:5",
        "bamboo:6",
        "dragon:green",
        "dragon:green",
        "dragon:white",
        "dragon:white",
        "wind:south",
        "wind:west",
        "wind:north"
      ]),
      supplementTile
    ];
    const wallLengthBeforeKong = game.wall.length;

    applyKong(game, 0, kongTiles.map((candidate) => candidate.id));

    expect(game.currentSeat).toBe(0);
    expect(game.players[0]!.melds.at(-1)?.type).toBe("concealedKong");
    expect(game.players[0]!.hand).toHaveLength(14);
    expect(game.players[0]!.drawnTileId).toBe(`supplement:${supplementTile.id}`);
    expect(game.players[0]!.hand.some((candidate) => candidate.id === supplementTile.id)).toBe(true);
    expect(game.wall).toHaveLength(wallLengthBeforeKong - 1);
  });

  it("allows a Taiwan ting player to declare an original concealed kong without exposing it", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const kongTiles = tiles(["dragon:red", "dragon:red", "dragon:red", "dragon:red"]);
    const supplementTile = tile("dots:9", 3);
    game.currentSeat = 0;
    game.players[0]!.declaredTing = true;
    game.players[0]!.hand = [
      ...kongTiles,
      ...tiles([
        "characters:1",
        "characters:2",
        "characters:3",
        "characters:4",
        "characters:5",
        "characters:6",
        "dots:1",
        "dots:2",
        "dots:3",
        "bamboo:1",
        "bamboo:2",
        "bamboo:3",
        "wind:east"
      ])
    ];
    game.wall = [
      ...tiles([
        "characters:7",
        "characters:8",
        "characters:9",
        "dots:4",
        "dots:5",
        "dots:6",
        "bamboo:4",
        "bamboo:5",
        "bamboo:6",
        "dragon:green",
        "dragon:green",
        "dragon:white",
        "dragon:white",
        "wind:south",
        "wind:west",
        "wind:north"
      ]),
      supplementTile
    ];

    const action = getPrivateState(game, 0).legalActions.find((candidate) => candidate.type === "kong");
    applyKong(game, 0, kongTiles.map((candidate) => candidate.id));

    const publicMeld = toPublicGameState(game).players[0]!.melds.at(-1)!;
    expect(action?.description).toBe("暗槓 中");
    expect(game.players[0]!.melds.at(-1)?.type).toBe("concealedKong");
    expect(publicMeld.type).toBe("concealedKong");
    expect(publicMeld.tiles.every((candidate) => candidate.label === "暗")).toBe(true);
    expect(game.players[0]!.drawnTileId).toBe(`supplement:${supplementTile.id}`);
  });

  it("does not allow a Taiwan ting player to kong with the newly drawn tile", () => {
    const game = createGame(seats(), { random: () => 0.42 });
    const existingTiles = tiles(["dragon:red", "dragon:red", "dragon:red"]);
    const drawnTile = tile("dragon:red", 3);
    game.currentSeat = 0;
    game.players[0]!.declaredTing = true;
    game.players[0]!.drawnTileId = drawnTile.id;
    game.players[0]!.hand = [
      ...existingTiles,
      ...tiles([
        "characters:1",
        "characters:2",
        "characters:3",
        "characters:4",
        "characters:5",
        "characters:6",
        "dots:1",
        "dots:2",
        "dots:3",
        "bamboo:1",
        "bamboo:2",
        "bamboo:3",
        "wind:east"
      ]),
      drawnTile
    ];

    const action = getPrivateState(game, 0).legalActions.find((candidate) => candidate.type === "kong");

    expect(action).toBeUndefined();
    expect(() => applyKong(game, 0, [...existingTiles, drawnTile].map((candidate) => candidate.id))).toThrow(
      "宣告聽牌後只能將新摸進的牌摸切。"
    );
  });

  it("auto-discards a drawn tile after riichi when self draw is not available", () => {
    const game = createGame(seats(), { mode: "riichi", random: () => 0.42 });
    const drawnTile = tile("dragon:white", 0);
    game.currentSeat = 0;
    game.wall = [
      tile("characters:9", 0),
      ...tiles([
        "characters:7",
        "characters:8",
        "characters:9",
        "dots:1",
        "dots:2",
        "dots:3",
        "dots:4",
        "dots:5",
        "dots:6",
        "bamboo:4",
        "bamboo:5",
        "bamboo:6",
        "dragon:red",
        "dragon:green",
        "wind:north"
      ])
    ];
    game.players[0]!.declaredRiichi = true;
    game.players[0]!.declaredTing = true;
    game.players[0]!.drawnTileId = drawnTile.id;
    game.players[0]!.hand = [
      ...tiles([
        "characters:1",
        "characters:2",
        "characters:3",
        "characters:4",
        "characters:5",
        "characters:6",
        "dots:1",
        "dots:2",
        "dots:3",
        "bamboo:1",
        "bamboo:2",
        "bamboo:3",
        "wind:east"
      ]),
      drawnTile
    ];
    game.players[1]!.hand = [];
    game.players[2]!.hand = [];
    game.players[3]!.hand = [];

    expect(autoRiichiDiscardIfNeeded(game, 0)).toBe(true);
    expect(game.players[0]!.discards.at(-1)?.id).toBe(drawnTile.id);
    expect(game.currentSeat).toBe(1);
  });

  it("settles riichi exhaustive draw with noten payments", () => {
    const game = createGame(seats(), { mode: "riichi", random: () => 0.42 });
    const discardTile = tile("dragon:white", 0);
    game.currentSeat = 0;
    game.wall = game.wall.slice(0, 14);
    game.players[0]!.hand = [
      ...tiles([
        "characters:1",
        "characters:1",
        "characters:4",
        "characters:7",
        "dots:1",
        "dots:4",
        "dots:7",
        "bamboo:1",
        "bamboo:4",
        "bamboo:7",
        "wind:east",
        "wind:south",
        "wind:west"
      ]),
      discardTile
    ];
    game.players[1]!.hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "dots:7",
      "dots:8",
      "dots:9",
      "bamboo:1",
      "bamboo:1",
      "bamboo:1",
      "wind:east"
    ]);
    game.players[2]!.hand = tiles([
      "characters:1",
      "characters:4",
      "characters:7",
      "dots:1",
      "dots:4",
      "dots:7",
      "bamboo:1",
      "bamboo:4",
      "bamboo:7",
      "wind:east",
      "wind:south",
      "wind:west",
      "wind:north"
    ]);
    game.players[3]!.hand = tiles([
      "characters:2",
      "characters:5",
      "characters:8",
      "dots:2",
      "dots:5",
      "dots:8",
      "bamboo:2",
      "bamboo:5",
      "bamboo:8",
      "dragon:red",
      "dragon:green",
      "dragon:white",
      "wind:north"
    ]);

    applyDiscard(game, 0, discardTile.id);

    expect(game.phase).toBe("draw");
    expect(game.settlement?.winMode).toBe("draw");
    expect(game.settlement?.tenpaiSeats).toEqual([1]);
    expect(game.settlement?.notenSeats).toEqual([0, 2, 3]);
    expect(game.players[1]!.coins).toBe(28000);
    expect(game.players[0]!.coins).toBe(24000);
    expect(game.players[2]!.coins).toBe(24000);
    expect(game.players[3]!.coins).toBe(24000);
  });

  it("settles a riichi self draw with majiang-core hule parameters", () => {
    const game = createGame(seats(), { mode: "riichi", random: () => 0.42 });
    const winningHand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "dots:1",
      "dots:2",
      "dots:3",
      "bamboo:1",
      "bamboo:2",
      "bamboo:3",
      "wind:east",
      "wind:east"
    ]);
    game.players[0]!.hand = winningHand;
    game.players[0]!.melds = [] as Meld[];
    game.players[0]!.drawnTileId = winningHand.at(-1)!.id;

    applySelfDrawWin(game, 0);

    expect(game.phase).toBe("settled");
    expect(game.settlement?.winnerSeat).toBe(0);
    expect(game.settlement?.patterns.length).toBeGreaterThan(0);
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
