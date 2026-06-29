import type { Meld, Tile } from "@taiwan-mahjong/shared";
import { decomposeWinningHand } from "./hand.js";
import { sortTiles, tileKey } from "./tiles.js";

interface SettlementHandUnit {
  tiles: Tile[];
}

export function orderWinningHandGroups(hand: Tile[], melds: Meld[], winningTile: Tile | undefined): Tile[] | undefined {
  if (!winningTile || winningTile.kind === "flower") {
    return undefined;
  }

  const winningKey = tileKey(winningTile);
  const decompositions = decomposeWinningHand(hand, melds);
  for (const decomposition of decompositions) {
    const closedGroups = decomposition.groups.slice(melds.length);
    const winningPair = decomposition.pairKey === winningKey;
    const winningGroupIndex = closedGroups.findIndex((group) => group.keys.includes(winningKey));
    if (!winningPair && winningGroupIndex < 0) {
      continue;
    }

    const remaining = sortTiles(hand.filter((tile) => tile.kind !== "flower"));
    const winningKeys = winningPair ? [winningKey, winningKey] : closedGroups[winningGroupIndex]!.keys;
    const winningTiles = consumeWinningUnitTiles(winningKeys, remaining, winningTile);
    if (!winningTiles) {
      continue;
    }

    const units: SettlementHandUnit[] = [];
    if (!winningPair) {
      const pairTiles = consumeTilesForKeys([decomposition.pairKey, decomposition.pairKey], remaining);
      if (!pairTiles) {
        continue;
      }
      units.push({ tiles: pairTiles });
    }

    let failedToMaterialize = false;
    for (const [index, group] of closedGroups.entries()) {
      if (!winningPair && index === winningGroupIndex) {
        continue;
      }
      const groupTiles = consumeTilesForKeys(group.keys, remaining);
      if (!groupTiles) {
        failedToMaterialize = true;
        break;
      }
      units.push({ tiles: groupTiles });
    }
    if (failedToMaterialize) {
      continue;
    }

    if (remaining.length > 0) {
      units.push({ tiles: sortTiles(remaining) });
    }

    return [...units.sort((left, right) => unitSortKey(left) - unitSortKey(right)).flatMap((unit) => unit.tiles), ...winningTiles];
  }

  return undefined;
}

function consumeWinningUnitTiles(keys: string[], remaining: Tile[], winningTile: Tile): Tile[] | undefined {
  const winningIndex = remaining.findIndex((tile) => tile.id === winningTile.id);
  if (winningIndex < 0) {
    return undefined;
  }

  const actualWinningTile = remaining.splice(winningIndex, 1)[0]!;
  const remainingKeys = [...keys];
  const reservedKeyIndex = remainingKeys.findIndex((key) => key === tileKey(actualWinningTile));
  if (reservedKeyIndex < 0) {
    return undefined;
  }
  remainingKeys.splice(reservedKeyIndex, 1);

  const unitTiles = consumeTilesForKeys(remainingKeys, remaining);
  if (!unitTiles) {
    return undefined;
  }
  return [...unitTiles, actualWinningTile];
}

function consumeTilesForKeys(keys: string[], remaining: Tile[]): Tile[] | undefined {
  const consumed: Tile[] = [];
  for (const key of keys) {
    const index = remaining.findIndex((tile) => tileKey(tile) === key);
    if (index < 0) {
      return undefined;
    }
    consumed.push(remaining.splice(index, 1)[0]!);
  }
  return sortTiles(consumed);
}

function unitSortKey(unit: SettlementHandUnit): number {
  return Math.min(...unit.tiles.map((tile) => tile.sortKey));
}
