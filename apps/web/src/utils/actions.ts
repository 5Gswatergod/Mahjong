import type { LegalAction, Tile } from "@taiwan-mahjong/shared";

export function actionPreviewTiles(action: LegalAction, hand: Tile[], handById: Map<string, Tile>, claimDiscard: Tile | undefined): Tile[] {
  if (action.tileIds?.length) {
    const tiles = action.tileIds.map((tileId) => handById.get(tileId)).filter((tile): tile is Tile => Boolean(tile));
    if (claimDiscard && action.fromSeat !== undefined) {
      return [...tiles, claimDiscard];
    }
    return tiles;
  }

  if (!claimDiscard || !["chow", "pong", "kong", "win"].includes(action.type)) {
    return [];
  }

  const needed = action.type === "kong" ? 3 : action.type === "pong" ? 2 : action.type === "win" ? 0 : 2;
  const matchingHandTiles = hand.filter((tile) => isSameTileFace(tile, claimDiscard)).slice(0, needed);
  return [...matchingHandTiles, claimDiscard];
}

export function buildActionHintIds(actions: LegalAction[], hand: Tile[], claimDiscard: Tile | undefined, drawnTileId: string | undefined): Set<string> {
  const ids = new Set<string>();

  for (const action of actions) {
    if ((action.type === "chow" || action.type === "kong") && action.tileIds) {
      for (const tileId of action.tileIds) {
        ids.add(tileId);
      }
    }

    if ((action.type === "chow" || action.type === "pong" || action.type === "kong") && !action.tileIds && claimDiscard) {
      for (const tile of hand) {
        if (isSameTileFace(tile, claimDiscard)) {
          ids.add(tile.id);
        }
      }
    }

    if (action.type === "win" && drawnTileId) {
      ids.add(drawnTileId);
    }
  }

  return ids;
}

function isSameTileFace(left: Tile, right: Tile): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "suited" && right.kind === "suited") {
    return left.suit === right.suit && left.rank === right.rank;
  }
  if (left.wind || right.wind) {
    return left.wind === right.wind;
  }
  if (left.dragon || right.dragon) {
    return left.dragon === right.dragon;
  }
  return left.flower === right.flower;
}
