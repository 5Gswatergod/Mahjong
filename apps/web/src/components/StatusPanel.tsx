import { Check, Crown, Sparkles } from "lucide-react";
import type { GameState, PrivatePlayerState } from "@taiwan-mahjong/shared";
import { windFullLabels } from "../constants";
import { formatLatency, formatPoints, latencyLevel, phaseLabel } from "../utils/labels";
import { MiniTile } from "./Tiles";

export function StatusPanel({
  game,
  privateState,
  mySeatIndex,
  onReady,
  mySeatReady,
  latencyMs
}: {
  game: GameState | null;
  privateState: PrivatePlayerState | null;
  mySeatIndex: number | undefined;
  onReady: () => void;
  mySeatReady: boolean | undefined;
  latencyMs: number | null;
}) {
  const selfPlayer = mySeatIndex === undefined ? undefined : game?.players.find((player) => player.seatIndex === mySeatIndex);
  const canReady = !game || game.phase === "settled" || game.phase === "draw";

  return (
    <aside className="statusPanel" aria-label="牌況">
      <div className="infoPanel currentPanel">
        <div className="panelTitle">
          <Sparkles size={17} />
          <h2>牌況</h2>
        </div>
        <dl className="statGrid">
          <div>
            <dt>階段</dt>
            <dd>{game ? phaseLabel(game.phase) : "等候"}</dd>
          </div>
          <div>
            <dt>牌山</dt>
            <dd>{game?.wallCount ?? 0}</dd>
          </div>
          <div>
            <dt>圈風</dt>
            <dd>{game ? windFullLabels[game.roundWind] : "-"}</dd>
          </div>
          <div>
            <dt>自風</dt>
            <dd>{selfPlayer ? windFullLabels[selfPlayer.wind] : "-"}</dd>
          </div>
          <div>
            <dt>手牌</dt>
            <dd>{privateState?.hand.length ?? 0}</dd>
          </div>
          <div>
            <dt>點數</dt>
            <dd>{formatPoints(selfPlayer?.coins ?? 0)}</dd>
          </div>
          <div>
            <dt>延遲</dt>
            <dd className={`latencyValue ${latencyLevel(latencyMs)}`}>{formatLatency(latencyMs)}</dd>
          </div>
        </dl>
        <button className={mySeatReady ? "readyButton ready" : "readyButton"} onClick={onReady} disabled={!canReady}>
          <Check size={18} />
          {mySeatReady ? "已準備" : game?.phase === "settled" || game?.phase === "draw" ? "下一局準備" : "準備"}
        </button>
      </div>

      <RiichiMeta game={game} />
    </aside>
  );
}

function RiichiMeta({ game }: { game: GameState | null }) {
  if (!game?.riichi) return null;
  return (
    <div className="infoPanel">
      <div className="panelTitle">
        <Crown size={17} />
        <h2>日麻資訊</h2>
      </div>
      <dl className="statGrid compact">
        <div>
          <dt>本場</dt>
          <dd>{game.riichi.honba}</dd>
        </div>
        <div>
          <dt>立直棒</dt>
          <dd>{game.riichi.riichiSticks}</dd>
        </div>
      </dl>
      <div className="doraStrip">
        <span>寶牌</span>
        {game.riichi.doraIndicators.map((tile) => (
          <MiniTile key={tile.id} tile={tile} />
        ))}
      </div>
    </div>
  );
}
