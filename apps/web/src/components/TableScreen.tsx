import { type CSSProperties } from "react";
import { Bot, RefreshCw } from "lucide-react";
import type { GameState, Meld, PublicPlayerState, RoomSnapshot } from "@taiwan-mahjong/shared";
import { modeLabels, windLabels } from "../constants";
import { activeDeadline, formatLatency, formatPoints, initials, phaseLabel } from "../utils/labels";
import { MeldTiles, MiniTile, TileBacks } from "./Tiles";

export function TableScreen({
  room,
  game,
  perspectiveSeatIndex,
  ownSeatIndex,
  privateMelds,
  myTurn,
  serverNow,
  latencyMs
}: {
  room: RoomSnapshot;
  game: GameState | null;
  perspectiveSeatIndex: number | undefined;
  ownSeatIndex: number | undefined;
  privateMelds: Meld[];
  myTurn: boolean;
  serverNow: number;
  latencyMs: number | null;
}) {
  if (!game) {
    return (
      <div className="gameBoard tableEmptyBoard">
        <div className="emptyBoardCenter">
          <RefreshCw size={28} />
          <strong>等待玩家入桌</strong>
          <span>{room.seats.filter((seat) => seat.playerId).length}/4</span>
        </div>
        <div className="waitingSeats">
          {room.seats.map((seat) => (
            <div className="waitingSeat" key={seat.seatIndex}>
              <span>{windLabels[seat.wind]}</span>
              <strong>{seat.name ?? "空位"}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const orderedSeats = game.players
    .map((player) => ({
      player,
      distance: perspectiveSeatIndex === undefined ? player.seatIndex : (player.seatIndex - perspectiveSeatIndex + 4) % 4
    }))
    .sort((left, right) => left.distance - right.distance);
  const bottomPlayer = orderedSeats.find(({ distance }) => distance === 0)?.player;
  const liveWallCount = Math.max(0, game.wallCount - game.deadWallCount);
  const currentPlayer = game.players.find((player) => player.seatIndex === game.currentSeat);
  const rightPlayer = orderedSeats.find(({ distance }) => distance === 1)?.player;
  const topPlayer = orderedSeats.find(({ distance }) => distance === 2)?.player;
  const leftPlayer = orderedSeats.find(({ distance }) => distance === 3)?.player;
  const lastDiscardPlayer = game.lastDiscard ? game.players[game.lastDiscard.seatIndex] : undefined;

  return (
    <div className={myTurn ? "gameBoard scaledTableBoard myTurn" : "gameBoard scaledTableBoard"}>
      <div className="tableStage">
        <div className="tableFelt" aria-hidden="true">
          <span className="feltGuide guideTop" />
          <span className="feltGuide guideRight" />
          <span className="feltGuide guideBottom" />
          <span className="feltGuide guideLeft" />
        </div>
        <div className="wallRail wallTop">
          <TileBacks count={18} />
        </div>
        <div className="wallRail wallRight">
          <TileBacks count={16} vertical />
        </div>
        <div className="wallRail wallLeft">
          <TileBacks count={16} vertical />
        </div>

        {orderedSeats.map(({ player, distance }) => (
          <PlayerBadgeCard
            key={`badge-${player.seatIndex}`}
            player={player}
            distance={distance}
            active={game.currentSeat === player.seatIndex}
            isSelf={player.seatIndex === ownSeatIndex}
          />
        ))}

        {orderedSeats.map(({ player, distance }) => (
          <FlowerRail key={`flowers-${player.seatIndex}`} player={player} distance={distance} />
        ))}

        {orderedSeats.map(({ player, distance }) => (
          <MeldRail
            key={`melds-${player.seatIndex}`}
            player={player}
            distance={distance}
            isSelf={player.seatIndex === ownSeatIndex}
            privateMelds={player.seatIndex === ownSeatIndex ? privateMelds : undefined}
          />
        ))}

        {orderedSeats.map(({ player, distance }) => (
          <PlayerSpot
            key={player.seatIndex}
            player={player}
            distance={distance}
            active={game.currentSeat === player.seatIndex}
            isSelf={player.seatIndex === ownSeatIndex}
          />
        ))}

        {orderedSeats.map(({ player, distance }) => (
          <RiverLane key={`river-${player.seatIndex}`} player={player} distance={distance} />
        ))}

        <div className="centerConsole">
          <span className="windMarker markerTop">{windLabels[topPlayer?.wind ?? "north"]}</span>
          <span className="windMarker markerRight">{windLabels[rightPlayer?.wind ?? "east"]}</span>
          <span className="windMarker markerBottom">{windLabels[bottomPlayer?.wind ?? "south"]}</span>
          <span className="windMarker markerLeft">{windLabels[leftPlayer?.wind ?? "west"]}</span>
          <div className="centerWallCount" aria-label={`剩 ${liveWallCount} 張`}>
            <span>剩</span>
            <strong>{liveWallCount}</strong>
            <span>張</span>
          </div>
          <div
            className={game.lastDiscard ? "lastDiscard" : "lastDiscard empty"}
            aria-label={game.lastDiscard && lastDiscardPlayer ? `${windLabels[lastDiscardPlayer.wind]}家打出` : "尚未出牌"}
          >
            <span className="lastDiscardTileSlot">{game.lastDiscard ? <MiniTile tile={game.lastDiscard.tile} /> : null}</span>
            <span className="lastDiscardLabel">{game.lastDiscard && lastDiscardPlayer ? `${windLabels[lastDiscardPlayer.wind]}家打出` : ""}</span>
          </div>
          <CenterCountdown game={game} serverNow={serverNow} />
        </div>

        <TableInfoPanel game={game} bottomPlayer={bottomPlayer} currentPlayer={currentPlayer} latencyMs={latencyMs} />
      </div>
    </div>
  );
}

function CenterCountdown({ game, serverNow }: { game: GameState; serverNow: number }) {
  const deadline = activeDeadline(game);

  if (deadline === undefined) {
    return (
      <div className="centerCountdown empty" aria-label="目前沒有倒數">
        <strong>0</strong>
        <span>出牌倒數</span>
      </div>
    );
  }

  const totalMs = game.phase === "claiming" ? game.config.claimWindowMs : game.config.autoDiscardMs;
  const remainingMs = Math.max(0, deadline - serverNow);
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const progress = Math.max(0, Math.min(1, remainingMs / Math.max(totalMs, 1)));
  const style = { "--timer-progress": `${progress * 360}deg` } as CSSProperties;

  return (
    <div className={seconds <= 3 ? "centerCountdown urgent" : "centerCountdown"} style={style} aria-label={`剩 ${seconds} 秒`}>
      <strong>{seconds}</strong>
      <span>{game.phase === "claiming" ? "回應倒數" : "出牌倒數"}</span>
    </div>
  );
}

function TableInfoPanel({
  game,
  bottomPlayer,
  currentPlayer,
  latencyMs
}: {
  game: GameState;
  bottomPlayer: PublicPlayerState | undefined;
  currentPlayer: PublicPlayerState | undefined;
  latencyMs: number | null;
}) {
  return (
    <aside className="tableInfoPanel" aria-label="牌局資訊">
      <span>{modeLabels[game.mode]}</span>
      <strong>{windLabels[game.roundWind]}場</strong>
      <span>{currentPlayer ? `${windLabels[currentPlayer.wind]}家` : "-"}</span>
      <span>{game.mode === "riichi" ? `${game.riichi?.honba ?? game.dealerStreak} 本場` : `${game.dealerStreak} 連莊`}</span>
      <strong>{formatPoints(bottomPlayer?.coins ?? 0)}</strong>
      <span>{phaseLabel(game.phase)}</span>
      <span className="latencyInfo">延遲 {formatLatency(latencyMs)}</span>
    </aside>
  );
}

function PlayerBadgeCard({
  player,
  distance,
  active,
  isSelf
}: {
  player: PublicPlayerState;
  distance: number;
  active: boolean;
  isSelf: boolean;
}) {
  return (
    <div className={["playerBadgeRail", `badge${distance}`, active ? "active" : "", isSelf ? "self" : ""].filter(Boolean).join(" ")}>
      <div className="playerBadge">
        <span className="avatar">{player.isBot ? <Bot size={18} /> : initials(player.name ?? windLabels[player.wind])}</span>
        <div>
          <strong>{player.name ?? `玩家 ${player.seatIndex + 1}`}</strong>
          <p>
            <span>{windLabels[player.wind]}家</span>
            <span className="badgePoints">{formatPoints(player.coins)}</span>
          </p>
        </div>
        <span className="turnChip">
          {active ? "出牌" : player.declaredRiichi ? "立直" : player.declaredTing ? "聽" : `${player.revealedHand?.length ?? player.handCount}張`}
        </span>
      </div>
    </div>
  );
}

function MeldRail({
  player,
  distance,
  isSelf,
  privateMelds
}: {
  player: PublicPlayerState;
  distance: number;
  isSelf: boolean;
  privateMelds: Meld[] | undefined;
}) {
  const displayMelds = privateMelds ?? player.melds;
  if (displayMelds.length === 0) {
    return null;
  }

  return (
    <div className={["meldRail", `meldRail${distance}`].join(" ")} aria-label={`${player.name ?? windLabels[player.wind]} 副露`}>
      {displayMelds.map((meld) => (
        <span className="spotMeld" key={meld.id}>
          <MeldTiles meld={meld} revealConcealed={isSelf} />
        </span>
      ))}
    </div>
  );
}

function FlowerRail({ player, distance }: { player: PublicPlayerState; distance: number }) {
  if (player.flowerTiles.length === 0) {
    return null;
  }

  return (
    <div className={["flowerRail", `flowerRail${distance}`].join(" ")} aria-label={`${player.name ?? windLabels[player.wind]} 花牌`}>
      {player.flowerTiles.map((tile) => (
        <MiniTile key={tile.id} tile={tile} flower />
      ))}
    </div>
  );
}

function PlayerSpot({
  player,
  distance,
  active,
  isSelf
}: {
  player: PublicPlayerState;
  distance: number;
  active: boolean;
  isSelf: boolean;
}) {
  const revealedHand = player.revealedHand;
  const showRevealedHand = Boolean(revealedHand?.length);
  const handRailClassName = ["revealedHandRail", distance === 1 || distance === 3 ? "side" : ""].filter(Boolean).join(" ");

  return (
    <div className={["playerSpot", `spot${distance}`, active ? "active" : "", isSelf ? "self" : ""].filter(Boolean).join(" ")}>
      {showRevealedHand ? (
        <div className={handRailClassName}>
          {revealedHand!.map((tile) => (
            <MiniTile key={tile.id} tile={tile} />
          ))}
        </div>
      ) : !isSelf ? (
        <div className={distance === 1 || distance === 3 ? "opponentWall vertical" : "opponentWall"}>
          <TileBacks count={Math.min(player.handCount, 18)} vertical={distance === 1 || distance === 3} />
        </div>
      ) : null}
    </div>
  );
}

function RiverLane({ player, distance }: { player: PublicPlayerState; distance: number }) {
  const latestDiscards = player.discards.slice(-18);
  if (latestDiscards.length === 0) {
    return null;
  }

  return (
    <div className={["riverLane", `river${distance}`].join(" ")}>
      {latestDiscards.map((tile) => (
        <MiniTile key={tile.id} tile={tile} />
      ))}
    </div>
  );
}
