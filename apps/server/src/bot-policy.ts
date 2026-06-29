import type { LegalAction, PrivatePlayerState } from "@taiwan-mahjong/shared";

export function chooseBotClaimAction(actions: LegalAction[]): LegalAction {
  return actions.find((action) => action.type === "win") ?? actions.find((action) => action.type === "pass") ?? actions[0]!;
}

export function chooseBotTurnAction(privateState: PrivatePlayerState): LegalAction | undefined {
  const actions = privateState.legalActions;
  const win = actions.find((action) => action.type === "win");
  if (win) return win;
  const riichi = actions.find((action) => action.type === "declareRiichi");
  if (riichi) return riichi;
  const discards = actions.filter((action) => action.type === "discard" && action.tileId);
  if (discards.length === 0) {
    return actions.find((action) => action.type === "pass");
  }
  const handById = new Map(privateState.hand.map((tile) => [tile.id, tile]));
  return [...discards].sort((left, right) => {
    const leftTile = handById.get(left.tileId!);
    const rightTile = handById.get(right.tileId!);
    return discardScore(leftTile) - discardScore(rightTile);
  })[0];
}

function discardScore(tile: PrivatePlayerState["hand"][number] | undefined): number {
  if (!tile) return 0;
  if (tile.kind === "honor") return 1;
  if (!tile.rank) return 1;
  const terminalPenalty = tile.rank === 1 || tile.rank === 9 ? 0 : 2;
  const middleBonus = tile.rank >= 3 && tile.rank <= 7 ? 2 : 1;
  return terminalPenalty + middleBonus;
}
