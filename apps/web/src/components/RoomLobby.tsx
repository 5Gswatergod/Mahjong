import { type ReactNode } from "react";
import { Check, Clock, Sparkles } from "lucide-react";
import type { GameState, RoomSnapshot } from "@taiwan-mahjong/shared";
import { modeLabels } from "../constants";
import { formatPoints, phaseLabel } from "../utils/labels";
import { SeatManager } from "./SeatManager";
import { TableScreen } from "./TableScreen";

export function RoomLobby({
  room,
  game,
  myPlayerId,
  mySeatIndex,
  canManageSeats,
  mySeatReady,
  onReady,
  onAddBot,
  onClearSeat,
  identityControl,
  serverNow,
  latencyMs
}: {
  room: RoomSnapshot;
  game: GameState | null;
  myPlayerId: string;
  mySeatIndex: number | undefined;
  canManageSeats: boolean;
  mySeatReady: boolean | undefined;
  onReady: () => void;
  onAddBot: (seatIndex: number) => void;
  onClearSeat: (seatIndex: number) => void;
  identityControl?: ReactNode;
  serverNow: number;
  latencyMs: number | null;
}) {
  const occupiedSeats = room.seats.filter((seat) => seat.playerId).length;
  const canReady = !game || game.phase === "settled" || game.phase === "draw";
  const readyText = mySeatReady ? "取消準備" : game?.phase === "settled" || game?.phase === "draw" ? "準備下一局" : "準備入桌";

  return (
    <div className="roomLobby">
      <div className="lobbySide">
        {identityControl}
        <SeatManager
          room={room}
          game={game}
          myPlayerId={myPlayerId}
          canManageSeats={canManageSeats}
          onAddBot={onAddBot}
          onClearSeat={onClearSeat}
        />
        <LobbyInfo room={room} game={game} occupiedSeats={occupiedSeats} />
      </div>

      <div className="lobbyTableArea">
        <TableScreen room={room} game={null} mySeatIndex={mySeatIndex} myTurn={false} serverNow={serverNow} latencyMs={latencyMs} />
        <div className="lobbyReadyBar">
          <button className={mySeatReady ? "readyButton ready" : "readyButton"} onClick={onReady} disabled={!canReady}>
            <Check size={18} />
            {readyText}
          </button>
          <div className="lobbyReadyCopy">
            <strong>{occupiedSeats}/4</strong>
            <span>{occupiedSeats === 4 ? "全員入桌後按準備即可開局" : "等待玩家加入或由房主補 AI"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LobbyInfo({ room, game, occupiedSeats }: { room: RoomSnapshot; game: GameState | null; occupiedSeats: number }) {
  return (
    <aside className="lobbyInfoPanel" aria-label="牌況">
      <div className="panelTitle">
        <Sparkles size={17} />
        <h2>牌況</h2>
        <span>{modeLabels[room.mode]}</span>
      </div>
      <dl className="statGrid compact">
        <div>
          <dt>階段</dt>
          <dd>{game ? phaseLabel(game.phase) : "等候"}</dd>
        </div>
        <div>
          <dt>人數</dt>
          <dd>{occupiedSeats}/4</dd>
        </div>
        <div>
          <dt>初始點</dt>
          <dd>{formatPoints(room.config.initialCoins)}</dd>
        </div>
        <div>
          <dt>底分 / 每台</dt>
          <dd>
            {formatPoints(room.config.basePoints)} / {formatPoints(room.config.pointPerTai)}
          </dd>
        </div>
        <div>
          <dt>吃碰反應</dt>
          <dd>
            <Clock size={13} /> {Math.round(room.config.claimWindowMs / 1000)} 秒
          </dd>
        </div>
        <div>
          <dt>自動出牌</dt>
          <dd>
            <Clock size={13} /> {Math.round(room.config.autoDiscardMs / 1000)} 秒
          </dd>
        </div>
      </dl>
    </aside>
  );
}
