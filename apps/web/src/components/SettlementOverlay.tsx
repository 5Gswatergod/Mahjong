import { Check, X } from "lucide-react";
import type { GameState, PrivatePlayerState, ScoringResult } from "@taiwan-mahjong/shared";
import { windFullLabels, windLabels } from "../constants";
import { formatPoints, formatSeatList, initials, scoreDeltaForSeat, settlementLevel, winModeLabel } from "../utils/labels";
import { MeldTiles, TileButton } from "./Tiles";

export function SettlementOverlay({
  result,
  game,
  privateState,
  mySeatReady,
  onReady,
  onClose
}: {
  result: ScoringResult;
  game: GameState | null;
  privateState: PrivatePlayerState | null;
  mySeatReady: boolean | undefined;
  onReady: () => void;
  onClose: () => void;
}) {
  const isDraw = result.winMode === "draw";
  const winner = typeof result.winnerSeat === "number" ? game?.players.find((player) => player.seatIndex === result.winnerSeat) : undefined;
  const isWinnerPerspective = !isDraw && privateState !== null && result.winnerSeat === privateState.seatIndex;
  const winnerIsDealer = game?.mode === "taiwan" && !isDraw && typeof result.winnerSeat === "number" && result.winnerSeat === game.dealerSeat;
  const displayTai = result.baseTai + (winnerIsDealer ? 1 : 0);
  const displayPatterns = winnerIsDealer
    ? [...result.patterns, { id: "dealer-bonus", name: "莊家", tai: 1 }]
    : result.patterns;
  const displayTiles = result.winnerHand ?? (isWinnerPerspective ? privateState.hand : []);
  const displayMelds = result.winnerMelds ?? [];
  const scoreRows = game?.players.map((player) => ({ player, delta: scoreDeltaForSeat(result, player.seatIndex) })) ?? [];

  return (
    <div className="settlementBackdrop" role="dialog" aria-modal="true" aria-label="結算">
      <section className="settlementScene">
        <div className="winnerShowcase">
          <span className="winnerAvatar">{isDraw ? "流" : initials(winner?.name ?? "和")}</span>
          <div>
            <span className="winnerLabel">{isDraw ? "荒牌流局" : winModeLabel(result.winMode)}</span>
            <h2>{isDraw ? result.drawReason ?? "流局" : winner?.name ?? `玩家 ${(result.winnerSeat ?? 0) + 1}`}</h2>
            <p>{isDraw ? "本局沒有玩家胡牌" : `${windFullLabels[winner?.wind ?? "east"]} · ${settlementLevel(displayTai)}`}</p>
          </div>
        </div>

        <div className="settlementBoard">
          <button className="closeSettlement" onClick={onClose} title="關閉結算">
            <X size={18} />
          </button>

          <div className="settlementTiles">
            {displayTiles.length > 0 || displayMelds.length > 0 ? (
              <>
                {displayMelds.map((meld) => (
                  <span className="settlementMeld" key={meld.id}>
                    <MeldTiles meld={meld} />
                  </span>
                ))}
                {displayTiles.map((tile) => (
                  <TileButton key={tile.id} tile={tile} disabled />
                ))}
              </>
            ) : (
              <span>{isDraw ? `聽牌：${formatSeatList(result.tenpaiSeats)}` : "贏家手牌僅本人可見"}</span>
            )}
          </div>

          <div className="settlementStats">
            <div className="fanDial">
              <strong>{displayTai}</strong>
              <span>{game?.mode === "riichi" ? "番" : "台"}</span>
            </div>
            <div className="patternList">
              {displayPatterns.length === 0 ? (
                <span className="patternPill">無役種變動</span>
              ) : (
                displayPatterns.map((pattern) => (
                  <span className="patternPill" key={pattern.id}>
                    {pattern.name}
                    {pattern.tai > 0 ? ` ${pattern.tai}${game?.mode === "riichi" ? "番" : "台"}` : ""}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="scoreboardRows">
            {scoreRows.map(({ player, delta }) => (
              <div className={delta > 0 ? "scoreRow positive" : delta < 0 ? "scoreRow negative" : "scoreRow"} key={player.seatIndex}>
                <span>{windLabels[player.wind]}</span>
                <strong>{player.name ?? `玩家 ${player.seatIndex + 1}`}</strong>
                <em>{delta === 0 ? "±0" : delta > 0 ? `+${formatPoints(delta)}` : `-${formatPoints(Math.abs(delta))}`}</em>
              </div>
            ))}
          </div>

          <div className="bigResult">
            <span>{isDraw ? "NO GAME" : settlementLevel(displayTai)}</span>
            <strong>{formatPoints(Math.max(result.totalGain, 0))} 點</strong>
          </div>

          <div className="settlementActions">
            <button className={mySeatReady ? "readyButton ready" : "readyButton"} onClick={onReady}>
              <Check size={18} />
              {mySeatReady ? "已準備" : "下一局準備"}
            </button>
            <button className="secondaryButton" onClick={onClose}>
              確定
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
