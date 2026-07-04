import { describe, expect, it } from "vitest";
import { createTileFromKey, tileKey } from "@taiwan-mahjong/game-core";
import type { LegalAction, Meld, PrivatePlayerState, Tile } from "@taiwan-mahjong/shared";
import {
  buildVisibleTileCounts,
  chooseBotClaimAction,
  chooseBotTurnAction,
  type BotDecisionContext
} from "../src/bot-policy.js";

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

function privateState(hand: Tile[], legalActions: LegalAction[] = discardActions(hand), drawnTileId?: string): PrivatePlayerState {
  return {
    seatIndex: 0,
    hand,
    privateMelds: [],
    legalActions,
    winningTiles: [],
    ...(drawnTileId ? { drawnTileId } : {}),
    tingDiscardIds: [],
    tingHints: []
  };
}

function discardActions(hand: Tile[]): LegalAction[] {
  return hand.map((candidate) => ({ type: "discard", tileId: candidate.id }));
}

function context(visibleTiles: Tile[], extras: BotDecisionContext = {}): BotDecisionContext {
  const visibleTileCounts: Record<string, number> = {};
  for (const visibleTile of visibleTiles) {
    if (visibleTile.kind === "flower") {
      continue;
    }
    const key = tileKey(visibleTile);
    visibleTileCounts[key] = (visibleTileCounts[key] ?? 0) + 1;
  }
  return {
    mode: "taiwan",
    visibleTileCounts,
    ...extras
  };
}

function selectedTileKey(hand: Tile[], action: LegalAction | undefined): string | undefined {
  const tileId = action?.tileId;
  return tileId ? tileKey(hand.find((candidate) => candidate.id === tileId)!) : undefined;
}

describe("bot policy", () => {
  it("takes a winning turn action before evaluating discards", () => {
    const hand = tiles(["characters:1", "characters:2", "characters:3"]);
    const action = chooseBotTurnAction(
      privateState(hand, [{ type: "discard", tileId: hand[0]!.id }, { type: "win" }]),
      context(hand)
    );

    expect(action?.type).toBe("win");
  });

  it("keeps pairs and connected shapes over an isolated honor", () => {
    const hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "dots:4",
      "dots:5",
      "dots:6",
      "bamboo:7",
      "bamboo:8",
      "bamboo:9",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "dragon:green",
      "dragon:green",
      "characters:5",
      "characters:6",
      "wind:north"
    ]);

    const action = chooseBotTurnAction(privateState(hand), context(hand));

    expect(selectedTileKey(hand, action)).toBe("wind:north");
  });

  it("chooses the discard that reaches tenpai", () => {
    const hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "dots:4",
      "dots:5",
      "dots:6",
      "bamboo:7",
      "bamboo:8",
      "bamboo:9",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "dragon:green",
      "dragon:green",
      "characters:5",
      "characters:6",
      "wind:north"
    ]);

    const action = chooseBotTurnAction(privateState(hand), context(hand));

    expect(selectedTileKey(hand, action)).toBe("wind:north");
  });

  it("prefers the tenpai discard with more live waits", () => {
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

    const action = chooseBotTurnAction(privateState(hand), context(hand));

    expect(selectedTileKey(hand, action)).toBe("characters:1");
  });

  it("declares a self kong when it does not worsen shanten", () => {
    const hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "dots:1",
      "dots:2",
      "dots:3",
      "bamboo:1",
      "bamboo:2",
      "bamboo:3",
      "dragon:green",
      "dragon:green",
      "characters:4",
      "characters:5",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "dragon:red"
    ]);
    const redTiles = hand.filter((candidate) => tileKey(candidate) === "dragon:red");
    const actions: LegalAction[] = [
      ...discardActions(hand),
      { type: "kong", tileIds: redTiles.map((candidate) => candidate.id) }
    ];

    const action = chooseBotTurnAction(privateState(hand, actions), context(hand));

    expect(action?.type).toBe("kong");
  });

  it("novice difficulty discards instead of declaring ting or kong", () => {
    const hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "dots:1",
      "dots:2",
      "dots:3",
      "bamboo:1",
      "bamboo:2",
      "bamboo:3",
      "dragon:green",
      "dragon:green",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "characters:4",
      "characters:5"
    ]);
    const redTiles = hand.filter((candidate) => tileKey(candidate) === "dragon:red");
    const actions: LegalAction[] = [
      { type: "declareTing" },
      { type: "kong", tileIds: redTiles.map((candidate) => candidate.id) },
      ...discardActions(hand)
    ];

    const action = chooseBotTurnAction(privateState(hand, actions), context(hand, { difficulty: "novice" }));

    expect(action?.type).toBe("discard");
  });

  it("dreamer refuses a low-tai Taiwan self draw", () => {
    const hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "dots:1",
      "dots:2",
      "dots:3",
      "dots:4",
      "dots:5",
      "dots:6",
      "bamboo:1",
      "bamboo:2",
      "bamboo:3",
      "wind:east",
      "wind:east"
    ]);
    const actions: LegalAction[] = [{ type: "win" }, ...discardActions(hand)];

    const action = chooseBotTurnAction(
      privateState(hand, actions, hand.at(-1)!.id),
      context(hand, {
        difficulty: "dreamer",
        seatIndex: 0,
        dealerSeat: 1,
        seatWind: "south",
        roundWind: "east"
      })
    );

    expect(action?.type).toBe("discard");
  });

  it("dreamer takes a Taiwan self draw worth at least ten tai", () => {
    const hand = tiles([
      "characters:1",
      "characters:1",
      "characters:1",
      "characters:2",
      "characters:2",
      "characters:2",
      "characters:3",
      "characters:3",
      "characters:3",
      "characters:4",
      "characters:4",
      "characters:4",
      "characters:5",
      "characters:5",
      "characters:5",
      "characters:6",
      "characters:6"
    ]);

    const action = chooseBotTurnAction(
      privateState(hand, [{ type: "win" }, ...discardActions(hand)], hand.at(-1)!.id),
      context(hand, {
        difficulty: "dreamer",
        seatIndex: 0,
        dealerSeat: 1,
        seatWind: "south",
        roundWind: "east"
      })
    );

    expect(action?.type).toBe("win");
  });

  it("dreamer passes a low-tai winning claim", () => {
    const hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "dots:1",
      "dots:2",
      "dots:3",
      "dots:4",
      "dots:5",
      "dots:6",
      "bamboo:1",
      "bamboo:2",
      "bamboo:3",
      "wind:east"
    ]);
    const discard = tile("wind:east", 1);

    const action = chooseBotClaimAction(
      [{ type: "win", tileId: discard.id, fromSeat: 1 }, { type: "pass" }],
      privateState(hand),
      context([...hand, discard], {
        difficulty: "dreamer",
        seatIndex: 0,
        dealerSeat: 1,
        seatWind: "south",
        roundWind: "east",
        claimDiscard: discard,
        claimFromSeat: 1
      })
    );

    expect(action.type).toBe("pass");
  });

  it("dreamer discards the off-suit tile to preserve high-tai potential", () => {
    const hand = tiles([
      "characters:1",
      "characters:1",
      "characters:2",
      "characters:2",
      "characters:3",
      "characters:3",
      "characters:4",
      "characters:4",
      "characters:5",
      "characters:5",
      "characters:6",
      "characters:6",
      "characters:7",
      "characters:8",
      "dragon:red",
      "dragon:red",
      "dots:9"
    ]);
    const red = hand.find((candidate) => tileKey(candidate) === "dragon:red")!;
    const offSuit = hand.find((candidate) => tileKey(candidate) === "dots:9")!;

    const action = chooseBotTurnAction(
      privateState(hand, [
        { type: "discard", tileId: red.id },
        { type: "discard", tileId: offSuit.id }
      ]),
      context(hand, {
        difficulty: "dreamer",
        seatIndex: 0,
        dealerSeat: 1,
        seatWind: "south",
        roundWind: "east"
      })
    );

    expect(selectedTileKey(hand, action)).toBe("dots:9");
  });

  it("expert prefers a safe discard against a declared ready opponent", () => {
    const hand = tiles([
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:5",
      "dots:3",
      "dots:4",
      "dots:5",
      "bamboo:3",
      "bamboo:4",
      "bamboo:5",
      "dragon:red",
      "dragon:red",
      "dragon:red",
      "wind:east",
      "wind:east",
      "dots:9"
    ]);
    const dangerousMiddle = hand.find((candidate) => tileKey(candidate) === "characters:5")!;
    const safeDiscard = hand.find((candidate) => tileKey(candidate) === "dots:9")!;
    const opponentDiscard = tile("dots:9", 1);

    const action = chooseBotTurnAction(
      privateState(hand, [
        { type: "discard", tileId: dangerousMiddle.id },
        { type: "discard", tileId: safeDiscard.id }
      ]),
      context([...hand, opponentDiscard], {
        difficulty: "expert",
        seatIndex: 0,
        dealerSeat: 1,
        seatWind: "south",
        roundWind: "east",
        wallCount: 20,
        visiblePlayers: [
          {
            seatIndex: 1,
            discards: [opponentDiscard],
            melds: [],
            declaredTing: true,
            declaredRiichi: true
          }
        ]
      })
    );

    expect(selectedTileKey(hand, action)).toBe("dots:9");
  });

  it("takes a winning claim before evaluating melds", () => {
    const hand = tiles(["characters:1", "characters:2"]);
    const discard = tile("characters:3", 0);
    const action = chooseBotClaimAction(
      [{ type: "pong", tileId: discard.id }, { type: "win", tileId: discard.id }, { type: "pass" }],
      privateState(hand),
      context([...hand, discard], { claimDiscard: discard })
    );

    expect(action.type).toBe("win");
  });

  it("novice difficulty passes non-winning claims", () => {
    const hand = tiles(["dragon:red", "dragon:red", "characters:2", "characters:3"]);
    const discard = tile("dragon:red", 2);

    const action = chooseBotClaimAction(
      [{ type: "pong", tileId: discard.id }, { type: "pass" }],
      privateState(hand),
      context([...hand, discard], { claimDiscard: discard, difficulty: "novice" })
    );

    expect(action.type).toBe("pass");
  });

  it("passes on a claim that breaks a ready hand", () => {
    const hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "characters:4",
      "characters:5",
      "characters:6",
      "dots:1",
      "dots:2",
      "dots:3",
      "dots:4",
      "dots:5",
      "dots:6",
      "bamboo:2",
      "bamboo:3",
      "wind:east",
      "wind:east"
    ]);
    const discard = tile("wind:east", 2);

    const action = chooseBotClaimAction(
      [{ type: "pong", tileId: discard.id }, { type: "pass" }],
      privateState(hand),
      context([...hand, discard], { claimDiscard: discard })
    );

    expect(action.type).toBe("pass");
  });

  it("accepts a claim that improves toward tenpai", () => {
    const hand = tiles([
      "characters:1",
      "characters:2",
      "characters:3",
      "dots:1",
      "dots:2",
      "dots:3",
      "bamboo:1",
      "bamboo:2",
      "bamboo:3",
      "dragon:green",
      "dragon:green",
      "characters:4",
      "characters:5",
      "dragon:red",
      "dragon:red",
      "wind:north"
    ]);
    const discard = tile("dragon:red", 2);

    const action = chooseBotClaimAction(
      [{ type: "pong", tileId: discard.id }, { type: "pass" }],
      privateState(hand),
      context([...hand, discard], { claimDiscard: discard })
    );

    expect(action.type).toBe("pong");
  });

  it("does not count opponent concealed kong tiles as visible", () => {
    const ownTiles = [tile("dragon:red", 0)];
    const concealedKong: Meld = {
      id: "opponent-hidden-kong",
      type: "concealedKong",
      tiles: [tile("dragon:red", 1), tile("dragon:red", 2), tile("dragon:red", 3), tile("dragon:red", 4)],
      concealed: true
    };

    const visibleTileCounts = buildVisibleTileCounts({
      knownTiles: ownTiles,
      ownSeatIndex: 0,
      visiblePlayers: [
        {
          seatIndex: 1,
          discards: [],
          melds: [concealedKong],
          declaredTing: false
        }
      ]
    });

    expect(visibleTileCounts["dragon:red"]).toBe(1);
  });
});
