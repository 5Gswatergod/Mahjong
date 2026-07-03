import { Check, X } from "lucide-react";
import type { GameState, PrivatePlayerState, ScoringResult } from "@taiwan-mahjong/shared";
import { windFullLabels, windLabels } from "../constants";
import { formatPoints, formatSeatList, initials, scoreDeltaForSeat, settlementLevel, winModeLabel } from "../utils/labels";
import { MeldTiles, MiniTile, TileButton } from "./Tiles";

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
  const unitLabel = game?.mode === "riichi" ? "番" : "台";
  const displayTai = displaySettlementTai(result);
  const displayPatterns = result.patterns;
  const displayTiles = result.winnerHand ?? (isWinnerPerspective ? privateState.hand : []);
  const displayMelds = result.winnerMelds ?? [];
  const scoreRows =
    game?.players.map((player) => ({
      player,
      delta: scoreDeltaForSeat(result, player.seatIndex),
      taiSummary: seatTaiSummary(result, player.seatIndex, unitLabel)
    })) ?? [];
  const sourceSummary = buildWinSourceSummary(result, game);

  return (
    <div className="settlementBackdrop" role="dialog" aria-modal="true" aria-label="結算">
      <section className="settlementScene">
        <div className="winnerShowcase">
          <span className="winnerAvatar">{isDraw ? "流" : initials(winner?.name ?? "和")}</span>
          <div>
            <span className="winnerLabel">{isDraw ? "荒牌流局" : winModeLabel(result.winMode)}</span>
            <h2>{isDraw ? result.drawReason ?? "流局" : winner?.name ?? `玩家 ${(result.winnerSeat ?? 0) + 1}`}</h2>
            <p>{isDraw ? "本局沒有玩家胡牌" : `${windFullLabels[winner?.wind ?? "east"]} · ${settlementLevel(displayTai)}`}</p>
            {!isDraw && sourceSummary ? <p className="winnerSourceSummary">{sourceSummary}</p> : null}
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

          {!isDraw && result.winningTile ? (
            <div className="winningTileSummary">
              <span>胡牌</span>
              <MiniTile tile={result.winningTile} />
              <strong>{sourceSummary}</strong>
            </div>
          ) : null}

          <div className="settlementStats">
            <div className="fanDial">
              <strong>{displayTai}</strong>
              <span>{unitLabel}</span>
            </div>
            <div className="patternList">
              {displayPatterns.length === 0 ? (
                <span className="patternPill">無役種變動</span>
              ) : (
                displayPatterns.map((pattern) => (
                  <span className="patternPill" key={pattern.id}>
                    {pattern.name}
                    {pattern.tai > 0 ? ` ${pattern.tai}${unitLabel}` : ""}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="scoreboardRows">
            {scoreRows.map(({ player, delta, taiSummary }) => (
              <div className={delta > 0 ? "scoreRow positive" : delta < 0 ? "scoreRow negative" : "scoreRow"} key={player.seatIndex}>
                <span className="scoreWind">{windLabels[player.wind]}</span>
                <div className="scorePlayerCell">
                  <strong>
                    <span className="scorePlayerName">{player.name ?? `玩家 ${player.seatIndex + 1}`}</span>
                    {taiSummary.primary ? <span className={taiSummary.primary.startsWith("-") ? "scoreTaiBadge negative" : "scoreTaiBadge positive"}>{taiSummary.primary}</span> : null}
                  </strong>
                  {taiSummary.adjustments.length > 0 ? (
                    <div className="scoreTaiAdjustments">
                      {taiSummary.adjustments.map((adjustment) => (
                        <span key={adjustment}>{adjustment}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
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

function displaySettlementTai(result: ScoringResult): number {
  if (result.payments.length === 0) {
    return result.baseTai;
  }
  return Math.max(result.baseTai, ...result.payments.map((payment) => payment.tai));
}

function seatTaiSummary(result: ScoringResult, seatIndex: number, unitLabel: string): { primary: string; adjustments: string[] } {
  const paidPayments = result.payments.filter((payment) => payment.fromSeat === seatIndex);
  const receivedPayments = result.payments.filter((payment) => payment.toSeat === seatIndex);

  if (paidPayments.length > 0) {
    return {
      primary: formatTaiBadge("-", paidPayments, unitLabel),
      adjustments: uniqueAdjustmentLabels(paidPayments, unitLabel)
    };
  }

  if (receivedPayments.length > 0) {
    return {
      primary: formatTaiBadge("+", receivedPayments, unitLabel),
      adjustments: uniqueAdjustmentLabels(receivedPayments, unitLabel)
    };
  }

  return { primary: "", adjustments: [] };
}

function formatTaiBadge(sign: "+" | "-", payments: ScoringResult["payments"], unitLabel: string): string {
  const taiValues = [...new Set(payments.map((payment) => payment.tai))].sort((left, right) => left - right);
  if (taiValues.length === 0 || taiValues.every((tai) => tai === 0)) {
    return "";
  }
  return `${sign}${taiValues.join("/")}${unitLabel}`;
}

function uniqueAdjustmentLabels(payments: ScoringResult["payments"], unitLabel: string): string[] {
  const labels = new Set<string>();
  for (const payment of payments) {
    for (const adjustment of payment.taiAdjustments ?? []) {
      labels.add(`${adjustment.label} +${adjustment.tai}${unitLabel}`);
    }
  }
  return [...labels];
}

function buildWinSourceSummary(result: ScoringResult, game: GameState | null): string {
  if (result.winMode === "draw") {
    return "";
  }

  if (result.winMode === "selfDraw" || result.winMode === "eightFlowers") {
    return result.winningTile ? `自摸 ${result.winningTile.label}` : "自摸";
  }

  if (result.winMode === "sevenFlowersRob") {
    return result.winningTile ? `七搶一 ${result.winningTile.label}` : "七搶一";
  }

  const fromPlayer = typeof result.fromSeat === "number" ? game?.players.find((player) => player.seatIndex === result.fromSeat) : undefined;
  const fromName = fromPlayer?.name ?? (typeof result.fromSeat === "number" ? `玩家 ${result.fromSeat + 1}` : "對手");
  const fromLabel = fromPlayer ? `${windLabels[fromPlayer.wind]}家 ${fromName}` : fromName;
  const actionLabel = result.winMode === "robKong" ? "搶槓" : "榮和";
  return result.winningTile ? `${actionLabel} ${result.winningTile.label}，${fromLabel} 放銃` : `${actionLabel}，${fromLabel} 放銃`;
}
