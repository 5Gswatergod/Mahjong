import {
  allPlayableTileKeys,
  calculateScore,
  createTileFromKey,
  keyRank,
  keySuit,
  tileKey
} from "@taiwan-mahjong/game-core";
import type { BotDifficulty, GameConfig, GameMode, LegalAction, Meld, PrivatePlayerState, Tile, Wind } from "@taiwan-mahjong/shared";

export interface BotVisiblePlayer {
  seatIndex: number;
  discards: Tile[];
  melds: Meld[];
  declaredTing: boolean;
  declaredRiichi?: boolean;
}

export interface BotDecisionContext {
  mode?: GameMode;
  difficulty?: BotDifficulty;
  seatIndex?: number;
  dealerSeat?: number;
  seatWind?: Wind;
  roundWind?: Wind;
  dealerStreak?: number;
  handId?: string;
  config?: Partial<GameConfig>;
  melds?: Meld[];
  flowers?: Tile[];
  declaredTing?: boolean;
  declaredHeavenTing?: boolean;
  declaredEarthTing?: boolean;
  isAfterKong?: boolean;
  isLastTile?: boolean;
  isInitialWin?: boolean;
  isFirstDrawWin?: boolean;
  visiblePlayers?: BotVisiblePlayer[];
  visibleTileCounts?: Record<string, number>;
  wallCount?: number;
  claimDiscard?: Tile;
  claimFromSeat?: number;
}

interface NormalizedBotContext {
  mode: GameMode;
  difficulty: BotDifficulty;
  seatIndex: number;
  dealerSeat: number;
  meldCount: number;
  melds: Meld[];
  handId: string;
  config?: Partial<GameConfig>;
  visibleTileCounts: Record<string, number>;
  wallCount: number;
  dealerStreak: number;
  flowers: Tile[];
  declaredTing: boolean;
  declaredHeavenTing: boolean;
  declaredEarthTing: boolean;
  isAfterKong: boolean;
  isLastTile: boolean;
  isInitialWin: boolean;
  isFirstDrawWin: boolean;
  opponents: BotVisiblePlayer[];
  seatWind?: Wind;
  roundWind?: Wind;
  claimDiscard?: Tile;
  claimFromSeat?: number;
}

interface HandScore {
  shanten: number;
  effectiveTileTypes: number;
  effectiveTileCount: number;
  shapeScore: number;
  dreamScore: number;
}

interface DiscardCandidate {
  action: LegalAction;
  tile: Tile;
  score: HandScore;
  dangerScore: number;
}

interface ClaimCandidate {
  action: LegalAction;
  score: HandScore;
  priority: number;
  valuable: boolean;
  dangerScore: number;
}

interface ShapeOption {
  groups: number;
  taatsu: number;
}

const playableKeys = allPlayableTileKeys();
const playableKeySet = new Set(playableKeys);
const keyIndices = new Map(playableKeys.map((key, index) => [key, index]));

export function buildVisibleTileCounts({
  knownTiles,
  visiblePlayers = [],
  ownSeatIndex,
  extraTiles = []
}: {
  knownTiles: Tile[];
  visiblePlayers?: BotVisiblePlayer[];
  ownSeatIndex?: number;
  extraTiles?: Tile[];
}): Record<string, number> {
  const counts: Record<string, number> = {};
  const seenTileIds = new Set<string>();
  const addTile = (tile: Tile): void => {
    if (tile.kind === "flower" || seenTileIds.has(tile.id)) {
      return;
    }
    seenTileIds.add(tile.id);
    const key = tileKey(tile);
    if (!playableKeySet.has(key)) {
      return;
    }
    counts[key] = (counts[key] ?? 0) + 1;
  };

  for (const tile of knownTiles) {
    addTile(tile);
  }
  for (const player of visiblePlayers) {
    for (const tile of player.discards) {
      addTile(tile);
    }
    for (const meld of player.melds) {
      if (meld.concealed && player.seatIndex !== ownSeatIndex) {
        continue;
      }
      for (const tile of meld.tiles) {
        addTile(tile);
      }
    }
  }
  for (const tile of extraTiles) {
    addTile(tile);
  }

  return counts;
}

export function chooseBotClaimAction(
  actions: LegalAction[],
  privateState?: PrivatePlayerState,
  context?: BotDecisionContext
): LegalAction {
  const pass = actions.find((action) => action.type === "pass");
  if (!privateState) {
    const win = actions.find((action) => action.type === "win");
    if (win) return win;
    return pass ?? actions[0]!;
  }

  const normalized = normalizeContext(
    context,
    context?.claimDiscard ? [...privateState.hand, context.claimDiscard] : privateState.hand,
    privateState.seatIndex
  );
  const win = actions.find((action) => action.type === "win");
  if (win && shouldTakeWin(win, privateState, normalized)) {
    return win;
  }
  if (normalized.difficulty === "novice") {
    return pass ?? actions[0]!;
  }

  const before = scoreTiles(privateState.hand, normalized);
  const claimCandidates = actions
    .filter((action) => action.type === "chow" || action.type === "pong" || action.type === "kong")
    .map((action) => scoreClaimAction(action, privateState.hand, before, normalized))
    .filter((candidate): candidate is ClaimCandidate => Boolean(candidate))
    .filter((candidate) => shouldTakeClaimCandidate(candidate, before, normalized))
    .sort((left, right) => compareClaimCandidates(left, right, normalized));

  return claimCandidates[0]?.action ?? pass ?? actions[0]!;
}

export function chooseBotTurnAction(privateState: PrivatePlayerState, context?: BotDecisionContext): LegalAction | undefined {
  const actions = privateState.legalActions;
  const normalized = normalizeContext(context, privateState.hand, privateState.seatIndex);
  const win = actions.find((action) => action.type === "win");
  if (win && shouldTakeWin(win, privateState, normalized)) {
    return win;
  }

  if (normalized.difficulty === "novice") {
    return chooseNoviceTurnAction(actions);
  }

  const riichi = actions.find((action) => action.type === "declareRiichi");
  if (riichi) return riichi;

  const declareTing = actions.find((action) => action.type === "declareTing");
  if (declareTing && shouldDeclareTing(privateState, normalized)) {
    return declareTing;
  }

  const kong = chooseUsefulTurnKong(actions, privateState, normalized);
  if (kong) {
    return kong;
  }

  return chooseBestDiscardAction(privateState, normalized)?.action ?? actions.find((action) => action.type === "pass");
}

function shouldTakeWin(action: LegalAction, privateState: PrivatePlayerState, context: NormalizedBotContext): boolean {
  if (context.difficulty !== "dreamer" || context.mode !== "taiwan") {
    return true;
  }
  return estimateTaiwanWinTai(action, privateState, context) >= 10;
}

function estimateTaiwanWinTai(action: LegalAction, privateState: PrivatePlayerState, context: NormalizedBotContext): number {
  const winnerSeat = context.seatIndex;
  const winningTile = context.claimDiscard ?? drawnTile(privateState);
  if (!winningTile) {
    return 0;
  }

  const winMode = context.claimDiscard ? "discard" : "selfDraw";
  const fromSeat = action.fromSeat ?? context.claimFromSeat;
  const players = [0, 1, 2, 3].map((seatIndex) => ({
    seatIndex,
    wind: seatIndex === winnerSeat ? context.seatWind ?? fallbackWind(seatIndex) : fallbackWind(seatIndex),
    hand: seatIndex === winnerSeat ? privateState.hand : [],
    flowers: seatIndex === winnerSeat ? context.flowers : [],
    melds: seatIndex === winnerSeat ? contextMelds(context) : [],
    declaredTing: seatIndex === winnerSeat ? context.declaredTing : false,
    declaredHeavenTing: seatIndex === winnerSeat ? context.declaredHeavenTing : false,
    declaredEarthTing: seatIndex === winnerSeat ? context.declaredEarthTing : false
  }));

  try {
    return calculateScore(
      players,
      {
        handId: context.handId,
        dealerSeat: context.dealerSeat,
        roundWind: context.roundWind ?? "east",
        dealerStreak: context.dealerStreak,
        ...(context.config ? { config: context.config } : {})
      },
      {
        winnerSeat,
        winMode,
        winningTile,
        ...(typeof fromSeat === "number" ? { fromSeat, responsibilitySeat: fromSeat } : {}),
        isAfterKong: context.isAfterKong,
        isLastTile: context.isLastTile,
        isInitialWin: context.isInitialWin,
        isFirstDrawWin: context.isFirstDrawWin
      }
    ).baseTai;
  } catch {
    return 0;
  }
}

function shouldTakeClaimCandidate(candidate: ClaimCandidate, before: HandScore, context: NormalizedBotContext): boolean {
  if (context.difficulty === "dreamer") {
    const dreamLoss = before.dreamScore - candidate.score.dreamScore;
    if (candidate.action.type === "chow" && candidate.score.shanten >= before.shanten && dreamLoss > 0) {
      return false;
    }
    if (dreamLoss > 10 && candidate.score.shanten >= before.shanten) {
      return false;
    }
    return candidate.score.shanten < before.shanten || candidate.valuable || candidate.score.dreamScore >= before.dreamScore + 4;
  }
  return context.difficulty === "expert" || candidate.score.shanten < before.shanten || candidate.valuable;
}

function chooseNoviceTurnAction(actions: LegalAction[]): LegalAction | undefined {
  return actions.find((action) => action.type === "discard" && action.tileId) ?? actions.find((action) => action.type === "pass");
}

function shouldDeclareTing(privateState: PrivatePlayerState, context: NormalizedBotContext): boolean {
  if (context.mode !== "taiwan") {
    return false;
  }
  const bestDiscard = chooseBestDiscardAction(privateState, context);
  return Boolean(bestDiscard && bestDiscard.score.shanten <= 0 && bestDiscard.score.effectiveTileCount > 0);
}

function chooseUsefulTurnKong(
  actions: LegalAction[],
  privateState: PrivatePlayerState,
  context: NormalizedBotContext
): LegalAction | undefined {
  const currentScore = scoreTiles(privateState.hand, context);
  const candidates = actions
    .filter((action) => action.type === "kong" && action.fromSeat === undefined && action.tileIds && action.tileIds.length > 0)
    .map((action) => {
      const afterKong = removeTilesByIds(privateState.hand, action.tileIds ?? []);
      const meldCount = context.meldCount + (action.meldId ? 0 : 1);
      const score = scoreTiles(afterKong, context, meldCount);
      return { action, score, tile: privateState.hand.find((tile) => action.tileIds?.includes(tile.id)) };
    })
    .filter(({ score }) => score.shanten <= currentScore.shanten)
    .sort((left, right) => {
      const shanten = left.score.shanten - right.score.shanten;
      if (shanten !== 0) return shanten;
      const effective = right.score.effectiveTileCount - left.score.effectiveTileCount;
      if (effective !== 0) return effective;
      return (right.tile ? tileKeepValue(right.tile, context) : 0) - (left.tile ? tileKeepValue(left.tile, context) : 0);
    });

  return candidates[0]?.action;
}

function chooseBestDiscardAction(
  privateState: PrivatePlayerState,
  context: NormalizedBotContext,
  hand = privateState.hand,
  meldCount = context.meldCount
): DiscardCandidate | undefined {
  const handById = new Map(hand.map((tile) => [tile.id, tile]));
  return privateState.legalActions
    .filter((action) => action.type === "discard" && action.tileId)
    .map((action) => {
      const tile = handById.get(action.tileId!);
      if (!tile) {
        return undefined;
      }
      return scoreDiscardAction(action, tile, hand, context, meldCount);
    })
    .filter((candidate): candidate is DiscardCandidate => Boolean(candidate))
    .sort((left, right) => compareDiscardCandidates(left, right, context))[0];
}

function scoreDiscardAction(
  action: LegalAction,
  tile: Tile,
  hand: Tile[],
  context: NormalizedBotContext,
  meldCount: number
): DiscardCandidate {
  const remaining = removeOneTileById(hand, tile.id);
  return {
    action,
    tile,
    score: scoreTiles(remaining, context, meldCount),
    dangerScore: discardDangerScore(tile, context)
  };
}

function scoreClaimAction(
  action: LegalAction,
  hand: Tile[],
  before: HandScore,
  context: NormalizedBotContext
): ClaimCandidate | undefined {
  const discard = context.claimDiscard;
  if (!discard) {
    return undefined;
  }

  const claimedHand = simulateClaimHand(action, hand, discard);
  if (!claimedHand) {
    return undefined;
  }

  const meldCount = context.meldCount + 1;
  const discardActions = claimedHand.map((tile) => ({ type: "discard" as const, tileId: tile.id }));
  const afterClaimState: PrivatePlayerState = {
    seatIndex: 0,
    hand: claimedHand,
    privateMelds: [],
    legalActions: discardActions,
    winningTiles: [],
    tingDiscardIds: [],
    tingHints: []
  };
  const bestAfterDiscard = chooseBestDiscardAction(afterClaimState, context, claimedHand, meldCount);
  if (!bestAfterDiscard) {
    return undefined;
  }

  const valuable = isValuableClaim(action, discard, context);
  const useful =
    bestAfterDiscard.score.shanten < before.shanten ||
    (bestAfterDiscard.score.shanten === before.shanten && bestAfterDiscard.score.effectiveTileCount > before.effectiveTileCount) ||
    (valuable &&
      bestAfterDiscard.score.shanten === before.shanten &&
      bestAfterDiscard.score.effectiveTileCount >= before.effectiveTileCount &&
      bestAfterDiscard.score.shapeScore >= before.shapeScore - 6);

  if (!useful) {
    return undefined;
  }

  return {
    action,
    score: bestAfterDiscard.score,
    priority: action.type === "kong" ? 3 : action.type === "pong" ? 2 : 1,
    valuable,
    dangerScore: bestAfterDiscard.dangerScore
  };
}

function scoreTiles(tiles: Tile[], context: NormalizedBotContext, meldCount = context.meldCount): HandScore {
  const shanten = estimateShanten(tiles, context.mode, meldCount);
  const improvingKeys = improvingTileKeys(tiles, context.mode, meldCount, shanten);
  let effectiveTileCount = 0;
  let effectiveTileTypes = 0;
  for (const key of improvingKeys) {
    const remaining = remainingCopies(key, context);
    if (remaining > 0) {
      effectiveTileTypes += 1;
      effectiveTileCount += remaining;
    }
  }

  return {
    shanten,
    effectiveTileTypes,
    effectiveTileCount,
    shapeScore: shapeScore(tiles, context, meldCount),
    dreamScore: dreamPotentialScore(tiles, context, meldCount)
  };
}

function estimateShanten(tiles: Tile[], mode: GameMode, meldCount: number): number {
  const groupsNeeded = Math.max(0, (mode === "riichi" ? 4 : 5) - meldCount);
  const counts = countsArray(tiles);
  const pairKeys = [undefined, ...playableKeys.filter((key) => countAt(counts, indexOfKey(key)) >= 2)];
  let best = 2 * groupsNeeded;

  for (const pairKey of pairKeys) {
    const working = [...counts];
    const hasPair = Boolean(pairKey);
    if (pairKey) {
      addCount(working, indexOfKey(pairKey), -2);
    }

    const options = new Map<string, ShapeOption>();
    collectShapeOptions(working, options, groupsNeeded);
    for (const option of options.values()) {
      const groups = Math.min(option.groups, groupsNeeded);
      const taatsu = Math.min(option.taatsu, Math.max(0, groupsNeeded - groups));
      best = Math.min(best, 2 * groupsNeeded - groups * 2 - taatsu - (hasPair ? 1 : 0));
    }
  }

  return Math.max(-1, best);
}

function collectShapeOptions(
  counts: number[],
  options: Map<string, ShapeOption>,
  maxGroups: number,
  groups = 0,
  taatsu = 0,
  seen = new Set<string>()
): void {
  if (groups > maxGroups || taatsu > maxGroups || groups + taatsu > maxGroups) {
    return;
  }
  const stateKey = `${counts.join("")}|${groups}|${taatsu}`;
  if (seen.has(stateKey)) {
    return;
  }
  seen.add(stateKey);

  const index = counts.findIndex((count) => count > 0);
  if (index < 0) {
    const capped = { groups, taatsu };
    options.set(`${groups}:${taatsu}`, capped);
    return;
  }

  addCount(counts, index, -1);
  collectShapeOptions(counts, options, maxGroups, groups, taatsu, seen);
  addCount(counts, index, 1);

  if (groups < maxGroups && countAt(counts, index) >= 3) {
    addCount(counts, index, -3);
    collectShapeOptions(counts, options, maxGroups, groups + 1, taatsu, seen);
    addCount(counts, index, 3);
  }

  if (groups + taatsu < maxGroups && countAt(counts, index) >= 2) {
    addCount(counts, index, -2);
    collectShapeOptions(counts, options, maxGroups, groups, taatsu + 1, seen);
    addCount(counts, index, 2);
  }

  const key = playableKeys[index]!;
  const suit = keySuit(key);
  const rank = keyRank(key);
  if (!suit || !rank) {
    return;
  }

  const second = indexForMaybeKey(`${suit}:${rank + 1}`);
  const third = indexForMaybeKey(`${suit}:${rank + 2}`);
  if (rank <= 7 && second >= 0 && third >= 0 && countAt(counts, second) > 0 && countAt(counts, third) > 0) {
    addCount(counts, index, -1);
    addCount(counts, second, -1);
    addCount(counts, third, -1);
    collectShapeOptions(counts, options, maxGroups, groups + 1, taatsu, seen);
    addCount(counts, index, 1);
    addCount(counts, second, 1);
    addCount(counts, third, 1);
  }

  if (groups + taatsu < maxGroups && rank <= 8 && second >= 0 && countAt(counts, second) > 0) {
    addCount(counts, index, -1);
    addCount(counts, second, -1);
    collectShapeOptions(counts, options, maxGroups, groups, taatsu + 1, seen);
    addCount(counts, index, 1);
    addCount(counts, second, 1);
  }

  if (groups + taatsu < maxGroups && rank <= 7 && third >= 0 && countAt(counts, third) > 0) {
    addCount(counts, index, -1);
    addCount(counts, third, -1);
    collectShapeOptions(counts, options, maxGroups, groups, taatsu + 1, seen);
    addCount(counts, index, 1);
    addCount(counts, third, 1);
  }
}

function improvingTileKeys(tiles: Tile[], mode: GameMode, meldCount: number, shanten: number): string[] {
  const counts = countPlayableTiles(tiles);
  return playableKeys.filter((key) => {
    if ((counts[key] ?? 0) >= 4) {
      return false;
    }
    return estimateShanten([...tiles, createTileFromKey(key)], mode, meldCount) < shanten;
  });
}

function shapeScore(tiles: Tile[], context: NormalizedBotContext, meldCount: number): number {
  const counts = countPlayableTiles(tiles);
  let score = meldCount * 18;

  for (const [key, count] of Object.entries(counts)) {
    const tile = createTileFromKey(key);
    const honor = honorKeepValue(tile, context);
    if (count >= 3) {
      score += 20 + honor * 2;
    } else if (count === 2) {
      score += 9 + honor;
    } else if (tile.kind === "honor") {
      score += honor - 5;
    } else {
      score += suitedSingletonScore(tile, counts);
    }
  }

  for (const suit of ["characters", "dots", "bamboo"] as const) {
    for (let rank = 1; rank <= 7; rank += 1) {
      score += Math.min(counts[`${suit}:${rank}`] ?? 0, counts[`${suit}:${rank + 1}`] ?? 0, counts[`${suit}:${rank + 2}`] ?? 0) * 5;
    }
    for (let rank = 1; rank <= 8; rank += 1) {
      score += Math.min(counts[`${suit}:${rank}`] ?? 0, counts[`${suit}:${rank + 1}`] ?? 0) * 3;
    }
    for (let rank = 1; rank <= 7; rank += 1) {
      score += Math.min(counts[`${suit}:${rank}`] ?? 0, counts[`${suit}:${rank + 2}`] ?? 0) * 2;
    }
  }

  return score;
}

function dreamPotentialScore(tiles: Tile[], context: NormalizedBotContext, meldCount: number): number {
  if (context.mode !== "taiwan") {
    return 0;
  }

  const meldTiles = context.melds.flatMap((meld) => meld.tiles.filter((tile) => tile.kind !== "flower"));
  const counts = countPlayableTiles([...tiles, ...meldTiles]);
  const suitedCounts = {
    characters: 0,
    dots: 0,
    bamboo: 0
  };
  let honorCount = 0;
  let score = context.flowers.length * 2;
  let triplets = 0;
  let pairs = 0;

  for (const [key, count] of Object.entries(counts)) {
    const suit = keySuit(key);
    if (suit) {
      suitedCounts[suit] += count;
    } else {
      honorCount += count;
    }

    if (count >= 3) {
      triplets += 1;
      score += key.startsWith("dragon:") || key.startsWith("wind:") ? 13 : 8;
      if (count === 4) {
        score += 3;
      }
    } else if (count === 2) {
      pairs += 1;
      score += key.startsWith("dragon:") || key.startsWith("wind:") ? 7 : 4;
    }

    if (key.startsWith("dragon:")) {
      score += count >= 3 ? 8 : count === 2 ? 5 : 1;
    }
    if (key === `wind:${context.seatWind}` || key === `wind:${context.roundWind}`) {
      score += count >= 3 ? 8 : count === 2 ? 5 : 1;
    }
  }

  const suitValues = Object.values(suitedCounts);
  const suitedTotal = suitValues.reduce((total, count) => total + count, 0);
  const dominantSuitCount = Math.max(...suitValues);
  const offSuitCount = suitedTotal - dominantSuitCount;
  if (dominantSuitCount > 0) {
    score += dominantSuitCount * 2 - offSuitCount * 4;
    if (offSuitCount === 0) {
      score += honorCount > 0 ? 24 : 32;
    } else if (dominantSuitCount >= 8 && offSuitCount <= 2) {
      score += 14 - offSuitCount * 4;
    }
  }

  score += triplets * 5 + pairs * 2;
  if (triplets + pairs >= 5) {
    score += 12;
  }
  if (context.melds.every((meld) => meld.concealed)) {
    score += 5;
  }
  score -= context.melds.filter((meld) => meld.type === "chow").length * 10;
  score += meldCount * 2;

  return score;
}

function suitedSingletonScore(tile: Tile, counts: Record<string, number>): number {
  if (!tile.suit || !tile.rank) {
    return 0;
  }
  const rank = tile.rank;
  const neighbors =
    (counts[`${tile.suit}:${rank - 2}`] ?? 0) +
    (counts[`${tile.suit}:${rank - 1}`] ?? 0) +
    (counts[`${tile.suit}:${rank + 1}`] ?? 0) +
    (counts[`${tile.suit}:${rank + 2}`] ?? 0);
  const middle = rank >= 3 && rank <= 7 ? 3 : rank === 2 || rank === 8 ? 1 : -2;
  return middle + neighbors * 2;
}

function compareDiscardCandidates(left: DiscardCandidate, right: DiscardCandidate, context: NormalizedBotContext): number {
  if (context.difficulty === "expert") {
    const safety = compareExpertDanger(left.dangerScore, right.dangerScore, left.score.shanten, right.score.shanten);
    if (safety !== 0) return safety;
  }
  if (context.difficulty === "dreamer") {
    const dream = compareDreamPotential(left.score, right.score);
    if (dream !== 0) return dream;
  }
  const shanten = left.score.shanten - right.score.shanten;
  if (shanten !== 0) return shanten;
  const effectiveCount = right.score.effectiveTileCount - left.score.effectiveTileCount;
  if (effectiveCount !== 0) return effectiveCount;
  const effectiveTypes = right.score.effectiveTileTypes - left.score.effectiveTileTypes;
  if (effectiveTypes !== 0) return effectiveTypes;
  const shape = right.score.shapeScore - left.score.shapeScore;
  if (shape !== 0) return shape;
  return tileKeepValue(left.tile) - tileKeepValue(right.tile);
}

function compareClaimCandidates(left: ClaimCandidate, right: ClaimCandidate, context: NormalizedBotContext): number {
  if (context.difficulty === "expert") {
    const safety = compareExpertDanger(left.dangerScore, right.dangerScore, left.score.shanten, right.score.shanten);
    if (safety !== 0) return safety;
  }
  if (context.difficulty === "dreamer") {
    const dream = compareDreamPotential(left.score, right.score);
    if (dream !== 0) return dream;
  }
  const shanten = left.score.shanten - right.score.shanten;
  if (shanten !== 0) return shanten;
  const effective = right.score.effectiveTileCount - left.score.effectiveTileCount;
  if (effective !== 0) return effective;
  const valuable = Number(right.valuable) - Number(left.valuable);
  if (valuable !== 0) return valuable;
  return right.priority - left.priority;
}

function compareExpertDanger(leftDanger: number, rightDanger: number, leftShanten: number, rightShanten: number): number {
  const danger = leftDanger - rightDanger;
  if (danger === 0) {
    return 0;
  }
  const shantenGap = Math.abs(leftShanten - rightShanten);
  const highRiskSwing = Math.abs(danger) >= 8 && Math.max(leftDanger, rightDanger) >= 8;
  if (leftShanten === rightShanten || (highRiskSwing && shantenGap <= 1)) {
    return danger;
  }
  return 0;
}

function compareDreamPotential(left: HandScore, right: HandScore): number {
  const shanten = left.shanten - right.shanten;
  if (Math.abs(shanten) > 1) {
    return shanten;
  }
  const dream = right.dreamScore - left.dreamScore;
  if (Math.abs(dream) >= 4) {
    return dream;
  }
  return shanten;
}

function discardDangerScore(tile: Tile, context: NormalizedBotContext): number {
  if (context.difficulty !== "expert") {
    return 0;
  }

  const key = tileKey(tile);
  const visibleCount = context.visibleTileCounts[key] ?? 0;
  let danger = 0;

  for (const opponent of context.opponents) {
    const threat = opponentThreat(opponent, context);
    if (threat <= 0) {
      continue;
    }

    if (opponent.discards.some((discard) => tileKey(discard) === key)) {
      danger -= threat * 2;
      continue;
    }

    danger += threat;
    if (visibleCount >= 4) {
      danger -= threat * 2;
    } else if (visibleCount >= 3) {
      danger -= threat;
    } else if (tile.kind === "honor") {
      danger += visibleCount <= 1 ? threat * 2 : threat;
    } else if (tile.rank) {
      if (tile.rank >= 4 && tile.rank <= 6) {
        danger += Math.ceil(threat * 0.75);
      } else if (tile.rank === 1 || tile.rank === 9) {
        danger -= Math.floor(threat * 0.5);
      }
    }
  }

  return Math.max(0, Math.round(danger));
}

function opponentThreat(opponent: BotVisiblePlayer, context: NormalizedBotContext): number {
  let threat = 0;
  if (opponent.declaredRiichi) {
    threat += 9;
  }
  if (opponent.declaredTing) {
    threat += 8;
  }

  const exposedMelds = opponent.melds.filter((meld) => !meld.concealed).length;
  if (exposedMelds >= 3) {
    threat += 5;
  } else if (exposedMelds === 2) {
    threat += 3;
  } else if (exposedMelds === 1) {
    threat += 1;
  }

  if (context.wallCount <= 18) {
    threat += 4;
  } else if (context.wallCount <= 30) {
    threat += 2;
  }
  if (opponent.discards.length >= 12) {
    threat += 2;
  }

  return threat;
}

function simulateClaimHand(action: LegalAction, hand: Tile[], discard: Tile): Tile[] | undefined {
  if (action.type === "chow") {
    if (!action.tileIds || action.tileIds.length !== 2) {
      return undefined;
    }
    return removeTilesByIds(hand, action.tileIds);
  }
  if (action.type === "pong") {
    return removeTilesByKey(hand, tileKey(discard), 2);
  }
  if (action.type === "kong") {
    return removeTilesByKey(hand, tileKey(discard), 3);
  }
  return undefined;
}

function isValuableClaim(action: LegalAction, discard: Tile, context: NormalizedBotContext): boolean {
  return (action.type === "pong" || action.type === "kong") && honorKeepValue(discard, context) >= 3;
}

function tileKeepValue(tile: Tile, context?: NormalizedBotContext): number {
  if (tile.kind === "honor") {
    return honorKeepValue(tile, context);
  }
  if (!tile.rank) {
    return 0;
  }
  if (tile.rank >= 3 && tile.rank <= 7) {
    return 3;
  }
  if (tile.rank === 2 || tile.rank === 8) {
    return 1;
  }
  return 0;
}

function honorKeepValue(tile: Tile, context?: NormalizedBotContext): number {
  if (tile.dragon) {
    return 4;
  }
  let score = 1;
  if (tile.wind && tile.wind === context?.seatWind) {
    score += 3;
  }
  if (tile.wind && tile.wind === context?.roundWind) {
    score += 3;
  }
  return score;
}

function remainingCopies(key: string, context: NormalizedBotContext): number {
  return Math.max(0, 4 - (context.visibleTileCounts[key] ?? 0));
}

function drawnTile(privateState: PrivatePlayerState): Tile | undefined {
  if (privateState.drawnTileId) {
    const tile = privateState.hand.find((candidate) => candidate.id === privateState.drawnTileId);
    if (tile) {
      return tile;
    }
  }
  return privateState.hand.at(-1);
}

function contextMelds(context: NormalizedBotContext): Meld[] {
  return context.melds;
}

function fallbackWind(seatIndex: number): Wind {
  return (["east", "south", "west", "north"] as const)[seatIndex] ?? "east";
}

function normalizeContext(context: BotDecisionContext | undefined, knownTiles: Tile[], fallbackSeatIndex = 0): NormalizedBotContext {
  const seatIndex = context?.seatIndex ?? fallbackSeatIndex;
  const melds = context?.melds ?? [];
  const normalized: NormalizedBotContext = {
    mode: context?.mode ?? "taiwan",
    difficulty: context?.difficulty ?? "beginner",
    seatIndex,
    dealerSeat: context?.dealerSeat ?? 0,
    meldCount: melds.length,
    melds,
    handId: context?.handId ?? "bot-policy-preview",
    visibleTileCounts: context?.visibleTileCounts
      ? { ...context.visibleTileCounts }
      : buildVisibleTileCounts({
          knownTiles,
          ownSeatIndex: seatIndex,
          ...(context?.visiblePlayers ? { visiblePlayers: context.visiblePlayers } : {}),
          ...(context?.claimDiscard ? { extraTiles: [context.claimDiscard] } : {})
        }),
    wallCount: context?.wallCount ?? 0,
    dealerStreak: context?.dealerStreak ?? 0,
    flowers: context?.flowers ?? [],
    declaredTing: context?.declaredTing ?? false,
    declaredHeavenTing: context?.declaredHeavenTing ?? false,
    declaredEarthTing: context?.declaredEarthTing ?? false,
    isAfterKong: context?.isAfterKong ?? false,
    isLastTile: context?.isLastTile ?? false,
    isInitialWin: context?.isInitialWin ?? false,
    isFirstDrawWin: context?.isFirstDrawWin ?? false,
    opponents: (context?.visiblePlayers ?? []).filter((player) => player.seatIndex !== seatIndex)
  };
  if (context?.config) {
    normalized.config = context.config;
  }
  if (context?.seatWind) {
    normalized.seatWind = context.seatWind;
  }
  if (context?.roundWind) {
    normalized.roundWind = context.roundWind;
  }
  if (context?.claimDiscard) {
    normalized.claimDiscard = context.claimDiscard;
  }
  if (typeof context?.claimFromSeat === "number") {
    normalized.claimFromSeat = context.claimFromSeat;
  }
  return normalized;
}

function countPlayableTiles(tiles: Tile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tile of tiles) {
    const key = tileKey(tile);
    if (!playableKeySet.has(key)) {
      continue;
    }
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countsArray(tiles: Tile[]): number[] {
  const counts = Array.from({ length: playableKeys.length }, () => 0);
  for (const tile of tiles) {
    const key = tileKey(tile);
    const index = keyIndices.get(key);
    if (index !== undefined) {
      addCount(counts, index, 1);
    }
  }
  return counts;
}

function countAt(counts: number[], index: number): number {
  return counts[index] ?? 0;
}

function addCount(counts: number[], index: number, delta: number): void {
  counts[index] = countAt(counts, index) + delta;
}

function removeOneTileById(tiles: Tile[], tileId: string): Tile[] {
  let removed = false;
  return tiles.filter((tile) => {
    if (!removed && tile.id === tileId) {
      removed = true;
      return false;
    }
    return true;
  });
}

function removeTilesByIds(tiles: Tile[], tileIds: string[]): Tile[] {
  const remainingIds = new Set(tileIds);
  return tiles.filter((tile) => {
    if (remainingIds.has(tile.id)) {
      remainingIds.delete(tile.id);
      return false;
    }
    return true;
  });
}

function removeTilesByKey(tiles: Tile[], key: string, count: number): Tile[] | undefined {
  let removed = 0;
  const remaining = tiles.filter((tile) => {
    if (removed < count && tileKey(tile) === key) {
      removed += 1;
      return false;
    }
    return true;
  });
  return removed === count ? remaining : undefined;
}

function indexOfKey(key: string): number {
  return keyIndices.get(key) ?? -1;
}

function indexForMaybeKey(key: string): number {
  return keyIndices.get(key) ?? -1;
}
