import { Bot, UserPlus, UserX, Users } from "lucide-react";
import type { GameState, RoomSnapshot } from "@taiwan-mahjong/shared";
import { modeLabels, windLabels } from "../constants";
import { formatPoints, seatStatusLabel } from "../utils/labels";

export function SeatManager({
  room,
  game,
  myPlayerId,
  canManageSeats,
  onAddBot,
  onClearSeat
}: {
  room: RoomSnapshot;
  game: GameState | null;
  myPlayerId: string;
  canManageSeats: boolean;
  onAddBot: (seatIndex: number) => void;
  onClearSeat: (seatIndex: number) => void;
}) {
  return (
    <aside className="seatManager" aria-label="座位與換人">
      <div className="panelTitle">
        <Users size={17} />
        <h2>換人</h2>
        <span>{modeLabels[room.mode]}</span>
      </div>
      <div className="seatList">
        {room.seats.map((seat) => {
          const canClear = canManageSeats && Boolean(seat.playerId) && seat.playerId !== room.hostPlayerId;
          return (
            <div className={seat.playerId === myPlayerId ? "seatRow self" : "seatRow"} key={seat.seatIndex}>
              <span className="windBadge">{windLabels[seat.wind]}</span>
              <div className="seatInfo">
                <strong>{seat.name ?? "空位"}</strong>
                <p>{seatStatusLabel(seat, room.hostPlayerId, myPlayerId)}</p>
              </div>
              {!seat.playerId && canManageSeats ? (
                <button className="smallIconButton" onClick={() => onAddBot(seat.seatIndex)} title="補 AI">
                  <Bot size={16} />
                </button>
              ) : canClear ? (
                <button className="smallIconButton danger" onClick={() => onClearSeat(seat.seatIndex)} title="釋出座位">
                  <UserX size={16} />
                </button>
              ) : (
                <span className={seat.ready || seat.isBot ? "statePill ready" : "statePill"}>{seat.isBot ? "AI" : seat.ready ? "Ready" : formatPoints(seat.coins)}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="seatManagerFooter">
        <UserPlus size={15} />
        <span>{canManageSeats ? "局末換人開放" : game ? "座位鎖定中" : "等待入桌"}</span>
      </div>
    </aside>
  );
}
