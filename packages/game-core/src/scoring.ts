import type {
  GameConfig,
  Meld,
  PatternScore,
  PaymentTaiAdjustment,
  ScoringResult,
  Tile,
  Wind,
  WinContext
} from "@taiwan-mahjong/shared";
import { DEFAULT_GAME_CONFIG } from "@taiwan-mahjong/shared";
import { decomposeWinningHand, getWinningTiles, type HandDecomposition } from "./hand.js";
import {
  hasFlowerSet,
  keyRank,
  keySuit,
  tileKey,
  tileTypeLabel
} from "./tiles.js";

export interface ScoringPlayer {
  seatIndex: number;
  wind: Wind;
  hand: Tile[];
  flowers: Tile[];
  melds: Meld[];
  declaredTing: boolean;
  declaredHeavenTing?: boolean;
  declaredEarthTing: boolean;
}

export interface ScoringTable {
  handId: string;
  dealerSeat: number;
  roundWind: Wind;
  dealerStreak: number;
  config?: Partial<GameConfig>;
}

interface EvaluatedPatternSet {
  patterns: PatternScore[];
  tai: number;
}

export function calculateScore(players: ScoringPlayer[], table: ScoringTable, context: WinContext): ScoringResult {
  const config = { ...DEFAULT_GAME_CONFIG, ...table.config };
  const winner = players[context.winnerSeat];
  if (!winner) {
    throw new Error(`Winner seat ${context.winnerSeat} is not available.`);
  }

  const finalHand = buildFinalHand(winner.hand, context);
  const decompositions = decomposeWinningHand(finalHand, winner.melds);
  const evaluated = decompositions.length > 0
    ? maxPatternSet(
        decompositions.map((decomposition) =>
          evaluatePatterns(winner, table, context, finalHand, decomposition)
        )
      )
    : evaluateFlowerOnlyPatterns(winner, context);

  const payments = buildPayments(context, table, evaluated.tai, config);
  const totalGain = payments.reduce((total, payment) => total + payment.amount, 0);

  return {
    handId: table.handId,
    winnerSeat: context.winnerSeat,
    winMode: context.winMode,
    ...(context.winningTile ? { winningTile: context.winningTile } : {}),
    ...(typeof context.fromSeat === "number" ? { fromSeat: context.fromSeat } : {}),
    ...(typeof context.responsibilitySeat === "number" ? { responsibilitySeat: context.responsibilitySeat } : {}),
    baseTai: evaluated.tai,
    patterns: evaluated.patterns,
    payments,
    totalGain
  };
}

function evaluatePatterns(
  winner: ScoringPlayer,
  table: ScoringTable,
  context: WinContext,
  finalHand: Tile[],
  decomposition: HandDecomposition
): EvaluatedPatternSet {
  const patterns: PatternScore[] = [];
  const allKeys = [
    ...finalHand.filter((tile) => tile.kind !== "flower").map(tileKey),
    ...winner.melds.flatMap((meld) => meld.tiles.filter((tile) => tile.kind !== "flower").map(tileKey))
  ];
  const groups = decomposition.groups;
  const tripletKeys = groups
    .filter((group) => group.kind === "triplet")
    .map((group) => group.keys[0]!)
    .filter(Boolean);
  const windTriplets = tripletKeys.filter((key) => key.startsWith("wind:"));
  const dragonTriplets = tripletKeys.filter((key) => key.startsWith("dragon:"));
  const allSuits = new Set(allKeys.map(keySuit).filter(Boolean));
  const honorCount = allKeys.filter((key) => key.startsWith("wind:") || key.startsWith("dragon:")).length;
  const allTilesAreHonors = allKeys.length > 0 && honorCount === allKeys.length;
  const allTilesAreOneSuit = allSuits.size === 1 && honorCount === 0;
  const halfFlush = allSuits.size === 1 && honorCount > 0;
  const noHonorsOrFlowers = honorCount === 0 && winner.flowers.length === 0;
  const allPongs = groups.every((group) => group.kind === "triplet");
  const bigThreeDragons = new Set(dragonTriplets).size === 3;
  const smallThreeDragons = new Set(dragonTriplets).size === 2 && decomposition.pairKey.startsWith("dragon:");
  const bigFourWinds = new Set(windTriplets).size === 4;
  const smallFourWinds = new Set(windTriplets).size === 3 && decomposition.pairKey.startsWith("wind:");
  const concealedTriplets = groups.filter((group) => group.kind === "triplet" && group.concealed).length;
  const isMenqing = winner.melds.every((meld) => meld.type === "concealedKong");
  const isSelfDraw = context.winMode === "selfDraw";
  const isHeavenTing = Boolean(winner.declaredHeavenTing);
  const isEarthTing = winner.declaredEarthTing;
  const isSpecialTing = isHeavenTing || isEarthTing;
  const isFiveConcealedTriplets = concealedTriplets >= 5;
  const isAllExposed = winner.melds.length === 5 && context.winMode === "discard";

  if (context.isInitialWin && winner.seatIndex === table.dealerSeat) {
    add(patterns, "heavenly-hand", "天胡", 24);
  }
  if (context.isFirstDrawWin && winner.seatIndex !== table.dealerSeat) {
    add(patterns, "earthly-hand", "地胡", 16);
  }
  if (context.isFirstRoundWin && context.winMode === "discard") {
    add(patterns, "human-hand", "人胡", 8);
  }

  if (bigFourWinds) {
    add(patterns, "big-four-winds", "大四喜", 16);
  } else if (smallFourWinds) {
    add(patterns, "small-four-winds", "小四喜", 8);
  }

  if (bigThreeDragons) {
    add(patterns, "big-three-dragons", "大三元", 8);
  } else if (smallThreeDragons) {
    add(patterns, "small-three-dragons", "小三元", 4);
  }

  if (allTilesAreHonors || allTilesAreOneSuit) {
    add(patterns, "clean-one-suit", "清一色", 8);
  } else if (halfFlush) {
    add(patterns, "half-flush", "湊一色", 4);
  }

  if (isFiveConcealedTriplets) {
    add(patterns, "five-concealed-triplets", "五暗刻", 8);
  } else if (concealedTriplets >= 4) {
    add(patterns, "four-concealed-triplets", "四暗坎", 5);
  } else if (concealedTriplets >= 3) {
    add(patterns, "three-concealed-triplets", "三暗坎", 2);
  }

  if (allPongs && !allTilesAreHonors && !isFiveConcealedTriplets) {
    add(patterns, "all-pongs", "對對胡", 4);
  }

  if (context.winMode === "eightFlowers") {
    add(patterns, "eight-flowers", "八仙過海", 8);
  }
  if (context.winMode === "sevenFlowersRob") {
    add(patterns, "seven-flowers-rob", "七搶一", 8);
  }
  if (winner.flowers.length >= 7 && context.isInitialWin) {
    add(patterns, "initial-flower-win", "配牌花胡", 4);
  }

  if (winner.flowers.length > 0) {
    add(patterns, "visible-flowers", `見花見台 x${winner.flowers.length}`, winner.flowers.length);
  }
  if (hasFlowerSet(winner.flowers, "season")) {
    add(patterns, "season-flower-set", "春夏秋冬", 2);
  }
  if (hasFlowerSet(winner.flowers, "plant")) {
    add(patterns, "plant-flower-set", "梅蘭竹菊", 2);
  }

  for (const key of new Set(windTriplets)) {
    add(patterns, `wind-triplet-${key}`, `${tileTypeLabel(key)}風刻`, 1);
  }

  if (!bigThreeDragons && !smallThreeDragons) {
    for (const key of new Set(dragonTriplets)) {
      add(patterns, `dragon-${key}`, `${tileTypeLabel(key)}三元台`, 1);
    }
  }

  if (winner.declaredTing && !isSpecialTing) {
    add(patterns, "declared-ting", "宣告聽牌", 1);
  }
  if (isHeavenTing) {
    add(patterns, "heaven-ting", "天聽", 8);
  }
  if (isEarthTing) {
    add(patterns, "earth-ting", "地聽", 4);
  }

  if (isFiveConcealedTriplets && isSelfDraw) {
    add(patterns, "concealed-self-draw", "不求自摸", 2);
  } else if (isMenqing && isSelfDraw && !isSpecialTing) {
    add(patterns, "menqing-self-draw", "門清自摸", 3);
  } else {
    if (isMenqing && !isSpecialTing && !isFiveConcealedTriplets) {
      add(patterns, "menqing", "門清", 1);
    }
    if (isSelfDraw) {
      add(patterns, "self-draw", "自摸", 1);
    }
  }

  for (const meld of winner.melds) {
    if (meld.type === "concealedKong") {
      add(patterns, `concealed-kong-${meld.id}`, "暗槓", 2);
    } else if (meld.type === "exposedKong" || meld.type === "addedKong") {
      add(patterns, `kong-${meld.id}`, "槓牌", 1);
    }
  }

  if (context.isAfterKong) {
    add(patterns, "after-kong", "槓上開花", 1);
  }
  if (context.winMode === "robKong") {
    add(patterns, "rob-kong", "搶槓", 1);
  }
  if (context.isLastTile) {
    add(patterns, "last-tile", "海底撈月", 1);
  }

  const waitPattern = detectWaitPattern(winner, context, decomposition);
  const effectiveWaitPattern = isAllExposed && waitPattern?.id === "single-wait" ? undefined : waitPattern;
  if (effectiveWaitPattern) {
    add(patterns, effectiveWaitPattern.id, effectiveWaitPattern.name, 1);
  }

  if (isPingHu(winner, context, decomposition, effectiveWaitPattern?.id)) {
    add(patterns, "ping-hu", "平胡", 2);
  }

  if (noHonorsOrFlowers) {
    add(patterns, "no-honors-no-flowers", "無字無花", 2);
  }

  if (isAllExposed) {
    add(patterns, "all-exposed", "全求", 2);
  }

  return {
    patterns,
    tai: patterns.reduce((total, pattern) => total + pattern.tai, 0)
  };
}

function evaluateFlowerOnlyPatterns(winner: ScoringPlayer, context: WinContext): EvaluatedPatternSet {
  const patterns: PatternScore[] = [];
  if (context.winMode === "eightFlowers") {
    add(patterns, "eight-flowers", "八仙過海", 8);
  }
  if (context.winMode === "sevenFlowersRob") {
    add(patterns, "seven-flowers-rob", "七搶一", 8);
  }
  if (context.isInitialWin) {
    add(patterns, "initial-flower-win", "配牌花胡", 4);
  }
  if (winner.flowers.length > 0) {
    add(patterns, "visible-flowers", `見花見台 x${winner.flowers.length}`, winner.flowers.length);
  }
  if (hasFlowerSet(winner.flowers, "season")) {
    add(patterns, "season-flower-set", "春夏秋冬", 2);
  }
  if (hasFlowerSet(winner.flowers, "plant")) {
    add(patterns, "plant-flower-set", "梅蘭竹菊", 2);
  }
  return {
    patterns,
    tai: patterns.reduce((total, pattern) => total + pattern.tai, 0)
  };
}

function buildPayments(
  context: WinContext,
  table: ScoringTable,
  baseTai: number,
  config: GameConfig
): ScoringResult["payments"] {
  const winnerSeat = context.winnerSeat;
  const payers =
    context.winMode === "selfDraw" || context.winMode === "eightFlowers"
      ? [0, 1, 2, 3].filter((seat) => seat !== winnerSeat)
      : [context.responsibilitySeat ?? context.fromSeat].filter((seat): seat is number => typeof seat === "number");

  return payers.map((fromSeat) => {
    const adjustments = paymentTaiAdjustments(winnerSeat, fromSeat, table);
    const tai = baseTai + adjustments.tai;
    const amount = config.basePoints + config.pointPerTai * tai;
    return {
      fromSeat,
      toSeat: winnerSeat,
      amount,
      tai,
      reason: adjustments.reason ? `胡牌 ${adjustments.reason}` : "胡牌",
      ...(adjustments.taiAdjustments.length > 0 ? { taiAdjustments: adjustments.taiAdjustments } : {})
    };
  });
}

function paymentTaiAdjustments(
  winnerSeat: number,
  payerSeat: number,
  table: ScoringTable
): { tai: number; reason: string; taiAdjustments: PaymentTaiAdjustment[] } {
  const reasons: string[] = [];
  const taiAdjustments: PaymentTaiAdjustment[] = [];
  let tai = 0;
  const dealerInvolved = winnerSeat === table.dealerSeat || payerSeat === table.dealerSeat;
  if (dealerInvolved) {
    const label = winnerSeat === table.dealerSeat ? "莊家胡" : "胡莊家";
    const adjustmentTai = 1;
    tai += adjustmentTai;
    reasons.push(`${label}+${adjustmentTai}`);
    taiAdjustments.push({ label, tai: adjustmentTai });
  }
  if (dealerInvolved && table.dealerStreak > 0) {
    const streakTai = table.dealerStreak * 2;
    const label = `連${table.dealerStreak}拉${table.dealerStreak}`;
    tai += streakTai;
    reasons.push(`${label}+${streakTai}`);
    taiAdjustments.push({ label, tai: streakTai });
  }
  return { tai, reason: reasons.join(" "), taiAdjustments };
}

function detectWaitPattern(
  winner: ScoringPlayer,
  context: WinContext,
  decomposition: HandDecomposition
): PatternScore | undefined {
  if (!context.winningTile || context.winMode === "eightFlowers" || context.winMode === "sevenFlowersRob") {
    return undefined;
  }

  const winningKey = tileKey(context.winningTile);
  const handBeforeWin = context.winMode === "selfDraw"
    ? removeOneTile(winner.hand, context.winningTile)
    : winner.hand;
  const winningTileCount = getWinningTiles(handBeforeWin, winner.melds).length;
  if (winningTileCount !== 1) {
    return undefined;
  }

  if (decomposition.pairKey === winningKey) {
    return { id: "single-wait", name: "單釣", tai: 1 };
  }

  for (const group of decomposition.groups) {
    if (group.kind !== "sequence" || !group.keys.includes(winningKey)) {
      continue;
    }
    const ranks = group.keys.map(keyRank);
    const rank = keyRank(winningKey);
    if (!rank || ranks.some((value) => !value)) {
      continue;
    }
    const sortedRanks = ranks.map((value) => value!).sort((left, right) => left - right);
    if (rank === sortedRanks[1]) {
      return { id: "closed-wait", name: "中洞", tai: 1 };
    }
    if (sortedRanks[0] === 1 && sortedRanks[1] === 2 && sortedRanks[2] === 3 && rank === 3) {
      return { id: "edge-wait", name: "邊張", tai: 1 };
    }
    if (sortedRanks[0] === 7 && sortedRanks[1] === 8 && sortedRanks[2] === 9 && rank === 7) {
      return { id: "edge-wait", name: "邊張", tai: 1 };
    }
  }

  return undefined;
}

function isPingHu(
  winner: ScoringPlayer,
  context: WinContext,
  decomposition: HandDecomposition,
  waitPatternId?: string
): boolean {
  if (context.winMode !== "discard" || waitPatternId) {
    return false;
  }
  if (winner.flowers.length > 0) {
    return false;
  }
  if (!decomposition.groups.every((group) => group.kind === "sequence")) {
    return false;
  }
  if (decomposition.pairKey.startsWith("wind:") || decomposition.pairKey.startsWith("dragon:")) {
    return false;
  }
  return true;
}

function buildFinalHand(hand: Tile[], context: WinContext): Tile[] {
  if (!context.winningTile || context.winMode === "selfDraw") {
    return hand;
  }
  if (hand.some((tile) => tile.id === context.winningTile?.id)) {
    return hand;
  }
  return [...hand, context.winningTile];
}

function removeOneTile(tiles: Tile[], target: Tile): Tile[] {
  let removed = false;
  return tiles.filter((tile) => {
    if (!removed && tile.id === target.id) {
      removed = true;
      return false;
    }
    return true;
  });
}

function maxPatternSet(patternSets: EvaluatedPatternSet[]): EvaluatedPatternSet {
  return patternSets.reduce((best, current) => (current.tai > best.tai ? current : best), patternSets[0]!);
}

function add(patterns: PatternScore[], id: string, name: string, tai: number): void {
  if (patterns.some((pattern) => pattern.id === id)) {
    return;
  }
  patterns.push({ id, name, tai });
}
