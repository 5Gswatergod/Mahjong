import Majiang from "@kobalab/majiang-core";
import type { Meld, PatternScore, ScoringResult, Tile, WinContext, Wind } from "@taiwan-mahjong/shared";
import { sortTiles, tileKey } from "./tiles.js";

type MajiangSuit = "m" | "p" | "s" | "z";

export interface RiichiScoringPlayer {
  seatIndex: number;
  wind: Wind;
  hand: Tile[];
  melds: Meld[];
  declaredRiichi: boolean;
}

export interface RiichiScoringTable {
  handId: string;
  dealerSeat: number;
  roundWind: Wind;
  honba: number;
  riichiSticks: number;
  doraIndicators: Tile[];
  uraDoraIndicators?: Tile[];
}

export function canRiichiWin(hand: Tile[], melds: Meld[] = [], winningTile?: Tile, context?: Partial<WinContext>): boolean {
  try {
    return evaluateRiichiHand(hand, melds, winningTile, context).defen > 0;
  } catch {
    return false;
  }
}

export function riichiShanten(hand: Tile[], melds: Meld[] = []): number {
  const shoupai = toMajiangShoupai(hand, melds);
  return Majiang.Util.xiangting(shoupai);
}

export function getRiichiWinningTiles(hand: Tile[], melds: Meld[], candidates: Tile[]): Tile[] {
  const counts = countTilesByKey([...hand, ...melds.flatMap((meld) => meld.tiles)]);
  return candidates.filter((tile) => (counts.get(tileKey(tile)) ?? 0) < 4 && canRiichiWin([...hand, tile], melds, tile, { winMode: "selfDraw" }));
}

export function calculateRiichiScore(players: RiichiScoringPlayer[], table: RiichiScoringTable, context: WinContext): ScoringResult {
  const winner = players[context.winnerSeat];
  if (!winner) {
    throw new Error(`Winner seat ${context.winnerSeat} is not available.`);
  }

  const evaluation = evaluateRiichiHand(winner.hand, winner.melds, context.winningTile, context, {
    roundWind: table.roundWind,
    seatWind: winner.wind,
    dealerSeat: table.dealerSeat,
    winnerSeat: context.winnerSeat,
    honba: table.honba,
    riichiSticks: table.riichiSticks,
    doraIndicators: table.doraIndicators,
    declaredRiichi: winner.declaredRiichi,
    ...(typeof context.fromSeat === "number" ? { fromSeat: context.fromSeat } : {}),
    ...(winner.declaredRiichi && table.uraDoraIndicators ? { uraDoraIndicators: table.uraDoraIndicators } : {})
  });

  const patterns: PatternScore[] = (evaluation.hupai ?? []).map((pattern, index) => ({
    id: `riichi-${index}-${pattern.name}`,
    name: pattern.name,
    tai: pattern.fanshu
  }));

  const payments = buildRiichiPayments(context, evaluation.fenpei ?? [], evaluation.fanshu ?? 0);
  const totalGain = payments.reduce((total, payment) => total + payment.amount, 0);

  return {
    handId: table.handId,
    winnerSeat: context.winnerSeat,
    winMode: context.winMode,
    ...(context.winningTile ? { winningTile: context.winningTile } : {}),
    ...(typeof context.fromSeat === "number" ? { fromSeat: context.fromSeat } : {}),
    ...(typeof context.responsibilitySeat === "number" ? { responsibilitySeat: context.responsibilitySeat } : {}),
    baseTai: evaluation.fanshu ?? 0,
    patterns,
    payments,
    totalGain
  };
}

function evaluateRiichiHand(
  hand: Tile[],
  melds: Meld[] = [],
  winningTile?: Tile,
  context: Partial<WinContext> = {},
  options: {
    roundWind?: Wind;
    seatWind?: Wind;
    dealerSeat?: number;
    winnerSeat?: number;
    fromSeat?: number;
    honba?: number;
    riichiSticks?: number;
    doraIndicators?: Tile[];
    uraDoraIndicators?: Tile[];
    declaredRiichi?: boolean;
  } = {}
): { hupai?: { name: string; fanshu: number }[]; fu?: number; fanshu?: number; defen: number; fenpei?: number[] } {
  const isRon = context.winMode === "discard" || context.winMode === "robKong";
  const completeHand = winningTile && !hand.some((tile) => tile.id === winningTile.id) ? [...hand, winningTile] : hand;
  const sorted = sortTiles(completeHand.filter((tile) => tile.kind !== "flower"));
  const win = winningTile ?? sorted.at(-1);
  if (!win) {
    return { defen: 0 };
  }

  const baseTiles = isRon ? removeOneTile(sorted, win) : sorted;
  const shoupai = toMajiangShoupai(baseTiles, melds, isRon ? undefined : win);
  const rongpai = isRon ? `${tileToMajiangCode(win)}+` : null;
  const param = Majiang.Util.hule_param({
    zhuangfeng: windIndex(options.roundWind ?? "east"),
    menfeng: windIndex(options.seatWind ?? "east"),
    lizhi: options.declaredRiichi ? 1 : 0,
    yifa: false,
    qianggang: context.winMode === "robKong",
    lingshang: Boolean(context.isAfterKong),
    haidi: context.isLastTile ? (isRon ? 2 : 1) : 0,
    tianhu: context.isInitialWin ? 1 : context.isFirstDrawWin ? 2 : 0,
    baopai: (options.doraIndicators ?? []).map(tileToMajiangCode),
    fubaopai: (options.uraDoraIndicators ?? []).map(tileToMajiangCode),
    changbang: options.honba ?? 0,
    lizhibang: options.riichiSticks ?? 0
  });
  const result = Majiang.Util.hule(shoupai, rongpai, param) as
    | { hupai?: { name: string; fanshu: number }[]; fu?: number; fanshu?: number; defen?: number; fenpei?: number[] }
    | undefined;

  return {
    ...(result ?? {}),
    defen: result?.defen ?? 0
  };
}

function toMajiangShoupai(hand: Tile[], melds: Meld[], zimoTile?: Tile): InstanceType<typeof Majiang.Shoupai> {
  const source = zimoTile ? removeOneTile(hand, zimoTile) : hand;
  const closedTiles = sortTiles(source.filter((tile) => tile.kind !== "flower"));
  const closedString = tilesToMajiangString(closedTiles);
  const meldStrings = melds.map(meldToMajiangString).filter((value): value is string => Boolean(value));
  const shoupai = Majiang.Shoupai.fromString([closedString, ...meldStrings].join(","));
  if (zimoTile) {
    shoupai.zimo(tileToMajiangCode(zimoTile));
  }
  return shoupai;
}

function tilesToMajiangString(tiles: Tile[]): string {
  const suits: MajiangSuit[] = ["m", "p", "s", "z"];
  const bySuit: Record<MajiangSuit, number[]> = { m: [], p: [], s: [], z: [] };
  for (const tile of tiles) {
    const suitCode = tileSuitCode(tile);
    if (!suitCode) {
      continue;
    }
    bySuit[suitCode]!.push(tileMajiangRank(tile));
  }
  return suits
    .map((suit) => (bySuit[suit].length > 0 ? `${suit}${bySuit[suit].sort((left, right) => left - right).join("")}` : ""))
    .join("");
}

function meldToMajiangString(meld: Meld): string | undefined {
  const tiles = sortTiles(meld.tiles.filter((tile) => tile.kind !== "flower"));
  if (tiles.length < 3) {
    return undefined;
  }
  const suitCode = tileSuitCode(tiles[0]!);
  if (!suitCode) {
    return undefined;
  }
  const ranks = tiles.map((tile) => tileMajiangRank(tile)).sort((left, right) => left - right);
  if (meld.type === "chow") {
    return `${suitCode}${ranks.join("")}-`;
  }
  const rank = ranks[0]!;
  if (meld.concealed || meld.type === "concealedKong") {
    return `${suitCode}${rank}${rank}${rank}${rank}`;
  }
  return `${suitCode}${rank}${rank}${rank}-`;
}

export function tileToMajiangCode(tile: Tile): string {
  const suitCode = tileSuitCode(tile);
  if (!suitCode) {
    throw new Error(`Unsupported riichi tile: ${tileKey(tile)}`);
  }
  return `${suitCode}${tileMajiangRank(tile)}`;
}

function tileSuitCode(tile: Tile): MajiangSuit | undefined {
  if (tile.suit === "characters") return "m";
  if (tile.suit === "dots") return "p";
  if (tile.suit === "bamboo") return "s";
  if (tile.wind || tile.dragon) return "z";
  return undefined;
}

function tileMajiangRank(tile: Tile): number {
  if (tile.red) return 0;
  if (tile.rank) return tile.rank;
  if (tile.wind === "east") return 1;
  if (tile.wind === "south") return 2;
  if (tile.wind === "west") return 3;
  if (tile.wind === "north") return 4;
  if (tile.dragon === "white") return 5;
  if (tile.dragon === "green") return 6;
  if (tile.dragon === "red") return 7;
  throw new Error(`Unsupported riichi tile: ${tileKey(tile)}`);
}

function windIndex(wind: Wind): number {
  return { east: 0, south: 1, west: 2, north: 3 }[wind];
}

function buildRiichiPayments(context: WinContext, fenpei: number[], tai: number): ScoringResult["payments"] {
  const winnerSeat = context.winnerSeat;
  return fenpei
    .map((delta, seatIndex) => ({ delta, seatIndex }))
    .filter(({ delta, seatIndex }) => delta < 0 && seatIndex !== winnerSeat)
    .map(({ delta, seatIndex }) => ({
      fromSeat: seatIndex,
      toSeat: winnerSeat,
      amount: Math.abs(delta),
      tai,
      reason: context.winMode === "selfDraw" ? "自摸" : "榮和"
    }));
}

function countTilesByKey(tiles: Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    if (tile.kind === "flower") {
      continue;
    }
    const key = tileKey(tile);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function removeOneTile(tiles: Tile[], target: Tile): Tile[] {
  let removed = false;
  return tiles.filter((tile) => {
    if (!removed && (tile === target || tile.id === target.id)) {
      removed = true;
      return false;
    }
    return true;
  });
}
