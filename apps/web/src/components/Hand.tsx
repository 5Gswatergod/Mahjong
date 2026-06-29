import type { Tile } from "@taiwan-mahjong/shared";
import { TileButton } from "./Tiles";

export function Hand({
  tiles,
  discardableIds,
  selectedTileId,
  drawnTileId,
  actionHintIds,
  onTileClick,
  myTurn
}: {
  tiles: Tile[];
  discardableIds: Set<string>;
  selectedTileId: string | null;
  drawnTileId: string | undefined;
  actionHintIds: Set<string>;
  onTileClick: (tile: Tile) => void;
  myTurn: boolean;
}) {
  return (
    <div className={myTurn ? "handDock myTurn" : "handDock"} aria-label="手牌">
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
    </div>
  );
}
