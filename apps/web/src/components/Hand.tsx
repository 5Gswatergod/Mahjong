import type { Tile } from "@taiwan-mahjong/shared";
import { MiniTile, TileButton } from "./Tiles";

export function Hand({
  tiles,
  winningTiles,
  showTingHint,
  discardableIds,
  selectedTileId,
  drawnTileId,
  actionHintIds,
  onTileClick,
  myTurn
}: {
  tiles: Tile[];
  winningTiles: Tile[];
  showTingHint: boolean;
  discardableIds: Set<string>;
  selectedTileId: string | null;
  drawnTileId: string | undefined;
  actionHintIds: Set<string>;
  onTileClick: (tile: Tile) => void;
  myTurn: boolean;
}) {
  const uniqueWinningTiles = dedupeTiles(winningTiles);
  const waitSummary = formatWaitSummary(uniqueWinningTiles);
  const hasTingHint = showTingHint && uniqueWinningTiles.length > 0;
  const className = ["handDock", myTurn ? "myTurn" : "", hasTingHint ? "hasTingHint" : ""].filter(Boolean).join(" ");

  return (
    <div className={className} aria-label="手牌">
      <div className="handStatus">{myTurn ? "輪到你" : "等待"}</div>
      <div className="handTiles">
        {tiles.map((tile) => (
          <TileButton
            key={tile.id}
            tile={tile}
            disabled={!discardableIds.has(tile.id)}
            highlighted={myTurn && discardableIds.has(tile.id)}
            selected={selectedTileId === tile.id}
            drawn={drawnTileId === tile.id}
            actionHint={actionHintIds.has(tile.id)}
            onClick={() => onTileClick(tile)}
          />
        ))}
      </div>
      {hasTingHint ? (
        <aside className="handTingHint" aria-label={waitSummary}>
          <strong>{waitSummary}</strong>
          <div className="handTingTiles">
            {uniqueWinningTiles.map((tile) => (
              <MiniTile key={`${tile.kind}-${tile.suit ?? tile.wind ?? tile.dragon ?? tile.flower}-${tile.rank ?? ""}`} tile={tile} />
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function dedupeTiles(tiles: Tile[]): Tile[] {
  const seen = new Set<string>();
  const uniqueTiles: Tile[] = [];
  for (const tile of tiles) {
    const key = tileTypeKey(tile);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueTiles.push(tile);
  }
  return uniqueTiles;
}

function formatWaitSummary(tiles: Tile[]): string {
  const suitedGroups: Record<"characters" | "dots" | "bamboo", number[]> = {
    characters: [],
    dots: [],
    bamboo: []
  };
  const honorLabels: string[] = [];

  for (const tile of tiles) {
    if (tile.kind === "suited" && tile.suit && typeof tile.rank === "number") {
      if (tile.suit === "characters") {
        suitedGroups.characters.push(tile.rank);
      } else if (tile.suit === "dots") {
        suitedGroups.dots.push(tile.rank);
      } else {
        suitedGroups.bamboo.push(tile.rank);
      }
    } else {
      honorLabels.push(formatHonorTile(tile));
    }
  }

  const parts = [
    formatSuitedGroup(suitedGroups.characters, "萬"),
    formatSuitedGroup(suitedGroups.dots, "筒"),
    formatSuitedGroup(suitedGroups.bamboo, "條"),
    ...honorLabels
  ].filter(Boolean);

  return parts.length > 0 ? `聽 ${parts.join("、")}` : "聽牌";
}

function formatSuitedGroup(ranks: number[], suitLabel: string): string {
  if (ranks.length === 0) {
    return "";
  }
  const sortedRanks = [...new Set(ranks)].sort((left, right) => left - right);
  return `${sortedRanks.join("、")}${suitLabel}`;
}

function formatHonorTile(tile: Tile): string {
  if (tile.wind) {
    return { east: "東", south: "南", west: "西", north: "北" }[tile.wind];
  }
  if (tile.dragon) {
    return { red: "中", green: "發", white: "白" }[tile.dragon];
  }
  return tile.label;
}

function tileTypeKey(tile: Tile): string {
  return `${tile.kind}:${tile.suit ?? ""}:${tile.rank ?? ""}:${tile.wind ?? ""}:${tile.dragon ?? ""}:${tile.flower ?? ""}`;
}
