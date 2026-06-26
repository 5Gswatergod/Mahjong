import type { Meld, Tile } from "@taiwan-mahjong/shared";
import {
  allPlayableTileKeys,
  createTileFromKey,
  isSuitedKey,
  keyRank,
  keySuit,
  tileKey
} from "./tiles.js";

export type GroupKind = "sequence" | "triplet";

export interface DecomposedGroup {
  kind: GroupKind;
  keys: string[];
  concealed: boolean;
}

export interface HandDecomposition {
  groups: DecomposedGroup[];
  pairKey: string;
}

export function countTileTypes(tiles: Tile[]): Map<string, number> {
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

export function meldToGroup(meld: Meld): DecomposedGroup {
  const keys = meld.tiles.filter((tile) => tile.kind !== "flower").map(tileKey);
  const uniqueKeys = new Set(keys);
  return {
    kind: uniqueKeys.size === 1 ? "triplet" : "sequence",
    keys,
    concealed: meld.type === "concealedKong"
  };
}

export function decomposeWinningHand(tiles: Tile[], melds: Meld[] = []): HandDecomposition[] {
  const nonFlowerTiles = tiles.filter((tile) => tile.kind !== "flower");
  const requiredGroups = 5 - melds.length;
  if (requiredGroups < 0 || nonFlowerTiles.length !== requiredGroups * 3 + 2) {
    return [];
  }

  const exposedGroups = melds.map(meldToGroup);
  const counts = countTileTypes(nonFlowerTiles);
  const decompositions: HandDecomposition[] = [];

  for (const [pairKey, count] of counts.entries()) {
    if (count < 2) {
      continue;
    }
    const remaining = new Map(counts);
    remaining.set(pairKey, count - 2);
    collectGroups(remaining, [], requiredGroups, (groups) => {
      decompositions.push({
        groups: [...exposedGroups, ...groups],
        pairKey
      });
    });
  }

  return dedupeDecompositions(decompositions);
}

export function canWin(tiles: Tile[], melds: Meld[] = []): boolean {
  return decomposeWinningHand(tiles, melds).length > 0;
}

export function canWinWithTile(hand: Tile[], tile: Tile, melds: Meld[] = []): boolean {
  return canWin([...hand, tile], melds);
}

export function getWinningTiles(hand: Tile[], melds: Meld[] = []): Tile[] {
  const counts = countTileTypes(hand);
  const winners: Tile[] = [];

  for (const key of allPlayableTileKeys()) {
    if ((counts.get(key) ?? 0) >= 4) {
      continue;
    }

    const virtualTile = createTileFromKey(key);
    if (canWinWithTile(hand, virtualTile, melds)) {
      winners.push(virtualTile);
    }
  }

  return winners;
}

export function isTing(hand: Tile[], melds: Meld[] = []): boolean {
  return getWinningTiles(hand, melds).length > 0;
}

export function possibleChows(hand: Tile[], discard: Tile): Tile[][] {
  if (discard.kind !== "suited" || !discard.suit || !discard.rank) {
    return [];
  }

  const options: Tile[][] = [];
  const byKey = new Map<string, Tile[]>();
  for (const tile of hand) {
    const key = tileKey(tile);
    const bucket = byKey.get(key) ?? [];
    bucket.push(tile);
    byKey.set(key, bucket);
  }

  for (const ranks of [
    [discard.rank - 2, discard.rank - 1],
    [discard.rank - 1, discard.rank + 1],
    [discard.rank + 1, discard.rank + 2]
  ]) {
    if (ranks.some((rank) => rank < 1 || rank > 9)) {
      continue;
    }
    const firstKey = `${discard.suit}:${ranks[0]}`;
    const secondKey = `${discard.suit}:${ranks[1]}`;
    const firstTile = byKey.get(firstKey)?.[0];
    const secondTile = byKey.get(secondKey)?.[0];
    if (firstTile && secondTile) {
      options.push([firstTile, secondTile]);
    }
  }

  return options;
}

function collectGroups(
  counts: Map<string, number>,
  groups: DecomposedGroup[],
  requiredGroups: number,
  onComplete: (groups: DecomposedGroup[]) => void
): void {
  if (groups.length === requiredGroups) {
    if ([...counts.values()].every((count) => count === 0)) {
      onComplete(groups);
    }
    return;
  }

  const nextKey = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))[0]?.[0];
  if (!nextKey) {
    return;
  }

  const count = counts.get(nextKey) ?? 0;
  if (count >= 3) {
    const nextCounts = new Map(counts);
    nextCounts.set(nextKey, count - 3);
    collectGroups(
      nextCounts,
      [...groups, { kind: "triplet", keys: [nextKey, nextKey, nextKey], concealed: true }],
      requiredGroups,
      onComplete
    );
  }

  if (!isSuitedKey(nextKey)) {
    return;
  }

  const suit = keySuit(nextKey);
  const rank = keyRank(nextKey);
  if (!suit || !rank || rank > 7) {
    return;
  }

  const secondKey = `${suit}:${rank + 1}`;
  const thirdKey = `${suit}:${rank + 2}`;
  if ((counts.get(secondKey) ?? 0) <= 0 || (counts.get(thirdKey) ?? 0) <= 0) {
    return;
  }

  const nextCounts = new Map(counts);
  nextCounts.set(nextKey, (nextCounts.get(nextKey) ?? 0) - 1);
  nextCounts.set(secondKey, (nextCounts.get(secondKey) ?? 0) - 1);
  nextCounts.set(thirdKey, (nextCounts.get(thirdKey) ?? 0) - 1);
  collectGroups(
    nextCounts,
    [...groups, { kind: "sequence", keys: [nextKey, secondKey, thirdKey], concealed: true }],
    requiredGroups,
    onComplete
  );
}

function dedupeDecompositions(decompositions: HandDecomposition[]): HandDecomposition[] {
  const seen = new Set<string>();
  const unique: HandDecomposition[] = [];
  for (const decomposition of decompositions) {
    const key = `${decomposition.pairKey}|${decomposition.groups
      .map((group) => `${group.kind}:${group.keys.join(",")}:${group.concealed}`)
      .sort()
      .join("|")}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(decomposition);
    }
  }
  return unique;
}
