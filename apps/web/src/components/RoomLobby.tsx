import { type ReactNode } from "react";
import { Check, Clock, Sparkles } from "lucide-react";
import type { GameState, RoomSnapshot } from "@taiwan-mahjong/shared";
import { modeLabels, windLabels } from "../constants";
import { formatPoints, phaseLabel } from "../utils/labels";
import { SeatManager } from "./SeatManager";
import { aiDifficultyLabels } from "./RoomSettingsPanel";
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
  const isDrawingSeats = Boolean(room.seatDraw);
  const canReady = !isDrawingSeats && (!game || game.phase === "settled" || game.phase === "draw");
  const readyText = isDrawingSeats ? "抓位中" : mySeatReady ? "取消準備" : game?.phase === "settled" || game?.phase === "draw" ? "準備下一局" : "準備入桌";

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
        <TableScreen
          room={room}
          game={null}
          mySeatIndex={mySeatIndex}
          privateMelds={[]}
          myTurn={false}
          serverNow={serverNow}
          latencyMs={latencyMs}
        />
        {room.seatDraw ? <SeatDrawCeremony room={room} serverNow={serverNow} /> : null}
        <div className="lobbyReadyBar">
          <button className={mySeatReady ? "readyButton ready" : "readyButton"} onClick={onReady} disabled={!canReady}>
            <Check size={18} />
            {readyText}
          </button>
          <div className="lobbyReadyCopy">
            <strong>{occupiedSeats}/4</strong>
            <span>{isDrawingSeats ? "正在依序抓風牌決定東南西北座位" : occupiedSeats === 4 ? "全員入桌後按準備即可開局" : "等待玩家加入或由房主補 AI"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SeatDrawCeremony({ room, serverNow }: { room: RoomSnapshot; serverNow: number }) {
  const draw = room.seatDraw;
  if (!draw) return null;

  const revealedCount = draw.cards.filter((card) => serverNow >= card.revealedAt).length;
  const secondsLeft = Math.max(0, Math.ceil((draw.completeAt - serverNow) / 1000));

  return (
    <div className="seatDrawCeremony" aria-live="polite">
      <div className="seatDrawHeader">
        <Sparkles size={17} />
        <strong>抓位牌</strong>
        <span>{revealedCount}/4</span>
      </div>
      <div className="seatDrawCards">
        {draw.cards.map((card) => {
          const revealed = serverNow >= card.revealedAt;
          return (
            <div
              className={revealed ? "seatDrawCard revealed" : "seatDrawCard"}
              key={`${draw.id}-${card.playerId}`}
              aria-label={revealed ? `${card.name} 抓到${windLabels[card.wind]}風` : `${card.name} 等待抓位牌`}
            >
              <span className="seatDrawOrder">{card.drawIndex + 1}</span>
              <span className="seatDrawTile">{revealed ? windLabels[card.wind] : ""}</span>
              <strong>{card.name}</strong>
              <em>{revealed ? `坐${windLabels[card.wind]}家` : "蓋牌"}</em>
            </div>
          );
        })}
      </div>
      <p>{secondsLeft > 0 ? `抓位完成後 ${secondsLeft} 秒開局` : "座位確認，準備開局"}</p>
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
        <div>
          <dt>AI 難度</dt>
          <dd>{aiDifficultyLabels[room.config.aiDifficulty]}</dd>
        </div>
      </dl>
    </aside>
  );
}
