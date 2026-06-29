import type { GameState, LegalAction, RoomSnapshot, ScoringResult } from "@taiwan-mahjong/shared";

export function phaseLabel(phase: GameState["phase"]): string {
  const labels: Record<GameState["phase"], string> = {
    waiting: "等待",
    playing: "對局中",
    claiming: "鳴牌回應",
    settled: "結算",
    draw: "流局"
  };
  return labels[phase];
}

export function activeDeadline(game: GameState): number | undefined {
  if (game.phase === "claiming") {
    return game.claimWindow?.deadlineAt;
  }
  if (game.phase === "playing") {
    return game.turnDeadlineAt;
  }
  return undefined;
}

export function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) return "測量中";
  return `${Math.round(latencyMs)} ms`;
}

export function latencyLevel(latencyMs: number | null): string {
  if (latencyMs === null) return "unknown";
  if (latencyMs >= 800) return "bad";
  if (latencyMs >= 300) return "warn";
  return "good";
}

export function actionLabel(action: LegalAction): string {
  if (action.description) return action.description;
  const labels: Record<LegalAction["type"], string> = {
    discard: "打",
    chow: "吃",
    pong: "碰",
    kong: "槓",
    win: "胡",
    pass: "過",
    declareTing: "聽",
    declareRiichi: "立直"
  };
  return labels[action.type];
}

export function actionButtonLabel(action: LegalAction): string {
  const labels: Record<LegalAction["type"], string> = {
    discard: "打",
    chow: "吃",
    pong: "碰",
    kong: "槓",
    win: "胡",
    pass: "過",
    declareTing: "聽牌",
    declareRiichi: "立直"
  };
  return labels[action.type] ?? actionLabel(action);
}

export function formatSeatList(seats: number[] | undefined): string {
  if (!seats || seats.length === 0) {
    return "無";
  }
  return seats.map((seat) => `${seat + 1}家`).join("、");
}

export function seatStatusLabel(
  seat: RoomSnapshot["seats"][number],
  hostPlayerId: string,
  myPlayerId: string
): string {
  if (!seat.playerId) return "可加入";
  if (seat.isBot) return "電腦玩家";
  if (seat.playerId === hostPlayerId) return seat.playerId === myPlayerId ? "房主 · 你" : "房主";
  if (seat.playerId === myPlayerId) return "你";
  return seat.connected ? "線上" : "離線";
}

export function initials(name: string): string {
  return Array.from(name.trim())[0] ?? "雀";
}

export function formatPoints(value: number): string {
  return new Intl.NumberFormat("zh-TW").format(Math.round(value));
}

export function winModeLabel(mode: ScoringResult["winMode"]): string {
  const labels: Record<ScoringResult["winMode"], string> = {
    selfDraw: "自摸",
    discard: "榮和",
    robKong: "搶槓",
    sevenFlowersRob: "七搶一",
    eightFlowers: "八仙過海",
    draw: "流局"
  };
  return labels[mode];
}

export function settlementLevel(tai: number): string {
  if (tai >= 13) return "役滿";
  if (tai >= 8) return "倍滿";
  if (tai >= 6) return "跳滿";
  if (tai >= 4) return "滿貫";
  return `${tai} 台`;
}

export function scoreDeltaForSeat(result: ScoringResult, seatIndex: number): number {
  return result.payments.reduce((total, payment) => {
    if (payment.toSeat === seatIndex) return total + payment.amount;
    if (payment.fromSeat === seatIndex) return total - payment.amount;
    return total;
  }, 0);
}
