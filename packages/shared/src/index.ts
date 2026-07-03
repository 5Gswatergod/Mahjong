export type Suit = "characters" | "dots" | "bamboo";
export type Wind = "east" | "south" | "west" | "north";
export type Dragon = "red" | "green" | "white";
export type GameMode = "taiwan" | "riichi";
export type BotDifficulty = "novice" | "beginner" | "expert";
export type Flower =
  | "spring"
  | "summer"
  | "autumn"
  | "winter"
  | "plum"
  | "orchid"
  | "chrysanthemum"
  | "bamboo";

export type TileKind = "suited" | "honor" | "flower";

export interface Tile {
  id: string;
  kind: TileKind;
  suit?: Suit;
  rank?: number;
  wind?: Wind;
  dragon?: Dragon;
  flower?: Flower;
  red?: boolean;
  copy: number;
  label: string;
  sortKey: number;
}

export type MeldType =
  | "chow"
  | "pong"
  | "exposedKong"
  | "concealedKong"
  | "addedKong";

export interface Meld {
  id: string;
  type: MeldType;
  tiles: Tile[];
  claimedTileId?: string;
  fromSeat?: number;
  concealed: boolean;
}

export interface PlayerSeat {
  seatIndex: number;
  wind: Wind;
  playerId?: string;
  name?: string;
  isBot?: boolean;
  coins: number;
  ready: boolean;
  connected: boolean;
}

export interface GameConfig {
  basePoints: number;
  pointPerTai: number;
  initialCoins: number;
  aiDifficulty: BotDifficulty;
  disconnectGraceMs: number;
  claimWindowMs: number;
  autoDiscardMs: number;
  latencyGraceMs: number;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  basePoints: 100,
  pointPerTai: 20,
  initialCoins: 10000,
  aiDifficulty: "beginner",
  disconnectGraceMs: 90_000,
  claimWindowMs: 8_000,
  autoDiscardMs: 12_000,
  latencyGraceMs: 800
};

export type GamePhase = "waiting" | "playing" | "claiming" | "settled" | "draw";
export type WinMode = "selfDraw" | "discard" | "robKong" | "sevenFlowersRob" | "eightFlowers";
export type SettlementMode = WinMode | "draw";

export interface RiichiRoundState {
  roundIndex: number;
  honba: number;
  riichiSticks: number;
  doraIndicators: Tile[];
  uraDoraIndicators?: Tile[];
}

export interface PatternScore {
  id: string;
  name: string;
  tai: number;
}

export interface LedgerEntry {
  id: string;
  handId: string;
  fromSeat: number;
  toSeat: number;
  amount: number;
  tai: number;
  reason: string;
  createdAt: number;
}

export interface PaymentResult {
  fromSeat: number;
  toSeat: number;
  amount: number;
  tai: number;
  reason: string;
  taiAdjustments?: PaymentTaiAdjustment[];
}

export interface PaymentTaiAdjustment {
  label: string;
  tai: number;
}

export interface ScoringResult {
  handId: string;
  winnerSeat?: number;
  winMode: SettlementMode;
  winningTile?: Tile;
  fromSeat?: number;
  responsibilitySeat?: number;
  drawReason?: string;
  tenpaiSeats?: number[];
  notenSeats?: number[];
  winnerHand?: Tile[];
  winnerMelds?: Meld[];
  baseTai: number;
  patterns: PatternScore[];
  payments: PaymentResult[];
  totalGain: number;
}

export interface WinContext {
  winnerSeat: number;
  winMode: WinMode;
  winningTile?: Tile;
  fromSeat?: number;
  responsibilitySeat?: number;
  isAfterKong?: boolean;
  isLastTile?: boolean;
  isInitialWin?: boolean;
  isFirstRoundWin?: boolean;
  isFirstDrawWin?: boolean;
}

export type LegalActionType =
  | "discard"
  | "chow"
  | "pong"
  | "kong"
  | "win"
  | "pass"
  | "declareTing"
  | "declareRiichi";

export interface LegalAction {
  type: LegalActionType;
  tileId?: string;
  tileIds?: string[];
  meldId?: string;
  fromSeat?: number;
  description?: string;
}

export interface ClaimOption {
  seatIndex: number;
  actions: LegalAction[];
}

export interface ClaimWindow {
  id: string;
  discard: Tile;
  fromSeat: number;
  deadlineAt: number;
  options: ClaimOption[];
  passedSeatIndices: number[];
}

export interface PublicPlayerState extends PlayerSeat {
  handCount: number;
  flowerTiles: Tile[];
  melds: Meld[];
  discards: Tile[];
  declaredTing: boolean;
  declaredRiichi?: boolean;
}

export interface PrivatePlayerState {
  seatIndex: number;
  hand: Tile[];
  privateMelds: Meld[];
  legalActions: LegalAction[];
  winningTiles: Tile[];
  drawnTileId?: string;
  tingDiscardIds: string[];
  tingHints: TingHint[];
}

export interface TingHint {
  discardTile: Tile;
  winningTiles: Tile[];
}

export interface GameState {
  id: string;
  handId: string;
  mode: GameMode;
  phase: GamePhase;
  serverTime: number;
  config: GameConfig;
  dealerSeat: number;
  currentSeat: number;
  turnDeadlineAt?: number;
  roundWind: Wind;
  dealerStreak: number;
  wallCount: number;
  deadWallCount: number;
  lastDiscard?: {
    seatIndex: number;
    tile: Tile;
  };
  claimWindow?: ClaimWindow;
  players: PublicPlayerState[];
  riichi?: RiichiRoundState;
  settlement?: ScoringResult;
  startedAt?: number;
  updatedAt: number;
}

export interface RoomSnapshot {
  code: string;
  mode: GameMode;
  config: GameConfig;
  serverTime: number;
  hostPlayerId: string;
  seats: PlayerSeat[];
  game?: GameState;
  createdAt: number;
  updatedAt: number;
}

export interface GuestAuthResponse {
  playerId: string;
  name: string;
  token: string;
}

export type ClientToServerEvents = {
  "room.ready": (payload: { ready: boolean }) => void;
  "room.addBot": (payload: { seatIndex: number }) => void;
  "room.clearSeat": (payload: { seatIndex: number }) => void;
  "room.leave": () => void;
  "game.discard": (payload: { tileId: string }) => void;
  "game.claim": (payload: { type: "chow" | "pong" | "kong" | "win" | "pass"; tileIds?: string[] }) => void;
  "game.kong": (payload: { tileIds: string[]; meldId?: string }) => void;
  "game.declareTing": () => void;
  "game.declareRiichi": () => void;
  "game.resync": () => void;
};

export type ServerToClientEvents = {
  "room.snapshot": (snapshot: RoomSnapshot) => void;
  "game.publicState": (state: GameState) => void;
  "game.privateState": (state: PrivatePlayerState) => void;
  "game.actionRequired": (actions: LegalAction[]) => void;
  "game.settlement": (result: ScoringResult) => void;
  "game.error": (error: { message: string }) => void;
  "connection.recovered": (payload: { roomCode: string; seatIndex: number }) => void;
};

export const winds: Wind[] = ["east", "south", "west", "north"];

export const gameModeLabels: Record<GameMode, string> = {
  taiwan: "台灣麻將",
  riichi: "日式麻將"
};

export const windLabels: Record<Wind, string> = {
  east: "東",
  south: "南",
  west: "西",
  north: "北"
};

export const suitLabels: Record<Suit, string> = {
  characters: "萬",
  dots: "筒",
  bamboo: "條"
};

export const dragonLabels: Record<Dragon, string> = {
  red: "中",
  green: "發",
  white: "白"
};

export const flowerLabels: Record<Flower, string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
  plum: "梅",
  orchid: "蘭",
  chrysanthemum: "菊",
  bamboo: "竹"
};
