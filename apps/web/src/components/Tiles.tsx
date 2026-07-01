import type { Meld, Tile } from "@taiwan-mahjong/shared";
import { tileImagePath } from "../tileAssets";

export function TileBacks({ count, vertical }: { count: number; vertical?: boolean }) {
  return (
    <div className={vertical ? "tileBacks vertical" : "tileBacks"} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function TileButton({
  tile,
  disabled,
  highlighted,
  selected,
  drawn,
  actionHint,
  onClick
}: {
  tile: Tile;
  disabled?: boolean;
  highlighted?: boolean;
  selected?: boolean;
  drawn?: boolean;
  actionHint?: boolean;
  onClick?: () => void;
}) {
  const imagePath = tile.label === "暗" ? undefined : tileImagePath(tile);
  const className = [
    "tileButton",
    highlighted ? "highlighted" : "",
    selected ? "selected" : "",
    drawn ? "drawn" : "",
    actionHint ? "actionHint" : "",
    tile.red ? "redFive" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={className} disabled={disabled} onClick={onClick} title={tile.label} aria-label={tile.label}>
      {imagePath ? <img className="tileImage" src={imagePath} alt="" draggable={false} /> : <span className="tileFallback">{tile.label}</span>}
    </button>
  );
}

export function MiniTile({ tile, flower }: { tile: Tile; flower?: boolean }) {
  const imagePath = tile.label === "暗" ? undefined : tileImagePath(tile);
  const className = ["miniTile", flower ? "flower" : "", tile.red ? "redFive" : ""].filter(Boolean).join(" ");

  return (
    <span className={className} title={tile.label} aria-label={tile.label}>
      {imagePath ? <img className="tileImage" src={imagePath} alt="" draggable={false} /> : <span className="tileFallback">{tile.label}</span>}
    </span>
  );
}

export function MeldTiles({ meld }: { meld: Meld }) {
  if (meld.concealed || meld.type === "concealedKong") {
    return (
      <span className="concealedMeld" aria-label="暗槓">
        <TileBacks count={meld.tiles.length} />
      </span>
    );
  }

  return (
    <>
      {meld.tiles.map((tile) => (
        <MiniTile key={`${meld.id}-${tile.id}`} tile={tile} />
      ))}
    </>
  );
}
