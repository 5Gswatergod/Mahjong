import type { LegalAction, Tile } from "@taiwan-mahjong/shared";
import { actionPreviewTiles } from "../utils/actions";
import { actionButtonLabel } from "../utils/labels";
import { MiniTile } from "./Tiles";

export function ActionDock({
  actions,
  hand,
  claimDiscard,
  onAction
}: {
  actions: LegalAction[];
  hand: Tile[];
  claimDiscard: Tile | undefined;
  onAction: (action: LegalAction) => void;
}) {
  const availableActions = actions.filter((action) => action.type !== "discard");
  if (availableActions.length === 0) return null;
  const handById = new Map(hand.map((tile) => [tile.id, tile]));
  return (
    <div className="actionDock">
      {availableActions.map((action, index) => {
        const previewTiles = actionPreviewTiles(action, hand, handById, claimDiscard);
        return (
          <button
            key={`${action.type}-${action.tileId ?? ""}-${action.tileIds?.join("-") ?? ""}-${action.meldId ?? ""}-${index}`}
            className={[
              action.type === "win" ? "actionButton win" : action.type === "pass" ? "actionButton pass" : "actionButton",
              previewTiles.length > 0 ? "withPreview" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onAction(action)}
            title={action.description ?? actionButtonLabel(action)}
          >
            <span className="actionButtonText">{actionButtonLabel(action)}</span>
            {previewTiles.length > 0 && (
              <span className="actionTilePreview">
                {previewTiles.map((tile) => (
                  <MiniTile key={`${action.type}-${action.meldId ?? action.tileId ?? ""}-${tile.id}`} tile={tile} />
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
