import {
  DEFAULT_GAME_CONFIG,
  type ClaimOption,
  type ClaimWindow,
  type GameConfig,
  type GameState,
  type GameMode,
  type LegalAction,
  type Meld,
  type PlayerSeat,
  type PrivatePlayerState,
  type ScoringResult,
  type Tile,
  type WinContext,
  type Wind,
  winds
} from "@taiwan-mahjong/shared";
import { canWin, canWinWithTile, getWinningTiles, isTing, possibleChows } from "./hand.js";
import { calculateScore, type ScoringPlayer, type ScoringTable } from "./scoring.js";
import { canRiichiWin, calculateRiichiScore, getRiichiWinningTiles, riichiShanten } from "./riichi.js";
import { orderWinningHandGroups } from "./settlement-hand.js";
import { allPlayableTileKeys, buildWall, createTileFromKey, nextSeat, sameTileType, seatDistance, shuffleTiles, sortTiles, tileKey } from "./tiles.js";

export interface CorePlayer {
  seatIndex: number;
  wind: Wind;
  playerId?: string;
  name?: string;
  isBot?: boolean;
  coins: number;
  ready: boolean;
  connected: boolean;
  hand: Tile[];
  flowers: Tile[];
  melds: Meld[];
  discards: Tile[];
  declaredTing: boolean;
  declaredRiichi: boolean;
  declaredHeavenTing: boolean;
  declaredEarthTing: boolean;
  firstDiscardMade: boolean;
  firstDrawMade: boolean;
  drawnTileId?: string;
  ronBlockedTileKeys: string[];
}

export interface CoreGame {
  id: string;
  handId: string;
  mode: GameMode;
  phase: GameState["phase"];
  config: GameConfig;
  dealerSeat: number;
  currentSeat: number;
  turnDeadlineAt?: number;
  roundWind: Wind;
  dealerStreak: number;
  wall: Tile[];
  players: CorePlayer[];
  riichi?: {
    roundIndex: number;
    honba: number;
    riichiSticks: number;
    doraIndicators: Tile[];
    uraDoraIndicators: Tile[];
  };
  lastDiscard?: {
    seatIndex: number;
    tile: Tile;
    firstDiscardOfSeat: boolean;
  };
  claimWindow?: ClaimWindow;
  pendingRobKong?: {
    fromSeat: number;
    tile: Tile;
    meldId: string;
  };
  settlement?: ScoringResult;
  firstClaimOrMeldHappened: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface CreateGameOptions {
  id?: string;
  handId?: string;
  mode?: GameMode;
  config?: Partial<GameConfig>;
  dealerSeat?: number;
  roundWind?: Wind;
  roundIndex?: number;
  dealerStreak?: number;
  random?: () => number;
}

export function createGame(seats: PlayerSeat[], options: CreateGameOptions = {}): CoreGame {
  const mode = options.mode ?? "taiwan";
  const dealerSeat = options.dealerSeat ?? 0;
  const startedAt = Date.now();
  const config = { ...DEFAULT_GAME_CONFIG, ...options.config };
  const players: CorePlayer[] = seats.map((seat) => {
    const coins = mode === "riichi" && seat.coins === DEFAULT_GAME_CONFIG.initialCoins ? 25000 : seat.coins;
    return {
      seatIndex: seat.seatIndex,
      wind: winds[(seat.seatIndex - dealerSeat + 4) % 4]!,
      ...(seat.playerId ? { playerId: seat.playerId } : {}),
      ...(seat.name ? { name: seat.name } : {}),
      ...(seat.isBot ? { isBot: true } : {}),
      coins,
      ready: seat.ready,
      connected: seat.connected,
      hand: [],
      flowers: [],
      melds: [],
      discards: [],
      declaredTing: false,
      declaredRiichi: false,
      declaredHeavenTing: false,
      declaredEarthTing: false,
      firstDiscardMade: false,
      firstDrawMade: false,
      ronBlockedTileKeys: []
    };
  });

  const game: CoreGame = {
    id: options.id ?? createId("game"),
    handId: options.handId ?? createId("hand"),
    mode,
    phase: "playing",
    config,
    dealerSeat,
    currentSeat: dealerSeat,
    roundWind: options.roundWind ?? "east",
    dealerStreak: options.dealerStreak ?? 0,
    wall: shuffleTiles(buildWall(mode), options.random),
    players,
    firstClaimOrMeldHappened: false,
    startedAt,
    updatedAt: startedAt
  };

  if (mode === "riichi") {
    const dora = game.wall.at(-5) ?? game.wall.at(-1);
    if (dora) {
      game.riichi = {
        roundIndex: options.roundIndex ?? 0,
        honba: options.dealerStreak ?? 0,
        riichiSticks: 0,
        doraIndicators: [dora],
        uraDoraIndicators: game.wall.slice(-10, -5)
      };
    }
  }

  for (const player of game.players) {
    const targetCount = mode === "riichi" ? (player.seatIndex === dealerSeat ? 14 : 13) : player.seatIndex === dealerSeat ? 17 : 16;
    drawUntilNonFlowerCount(game, player, targetCount, true);
    player.hand = sortTiles(player.hand);
  }

  if (mode === "taiwan") {
    resolveImmediateFlowerWin(game, true);
  }
  if (game.phase === "playing") {
    startTurnTimer(game);
  }
  touch(game);
  return game;
}

export function toPublicGameState(game: CoreGame): GameState {
  return {
    id: game.id,
    handId: game.handId,
    mode: game.mode,
    phase: game.phase,
    serverTime: Date.now(),
    config: game.config,
    dealerSeat: game.dealerSeat,
    currentSeat: game.currentSeat,
    ...(game.turnDeadlineAt ? { turnDeadlineAt: game.turnDeadlineAt } : {}),
    roundWind: game.roundWind,
    dealerStreak: game.dealerStreak,
    wallCount: game.wall.length,
    deadWallCount: Math.min(deadWallLimit(game), game.wall.length),
    ...(game.lastDiscard
      ? { lastDiscard: { seatIndex: game.lastDiscard.seatIndex, tile: game.lastDiscard.tile } }
      : {}),
    ...(game.claimWindow ? { claimWindow: game.claimWindow } : {}),
    players: game.players.map((player) => ({
      seatIndex: player.seatIndex,
      wind: player.wind,
      ...(player.playerId ? { playerId: player.playerId } : {}),
      ...(player.name ? { name: player.name } : {}),
      ...(player.isBot ? { isBot: true } : {}),
      coins: player.coins,
      ready: player.ready,
      connected: player.connected,
      handCount: player.hand.length,
      flowerTiles: player.flowers,
      melds: publicMelds(player.melds),
      discards: player.discards,
      declaredTing: player.declaredTing,
      ...(player.declaredRiichi ? { declaredRiichi: true } : {})
    })),
    ...(game.riichi
      ? {
          riichi: {
            roundIndex: game.riichi.roundIndex,
            honba: game.riichi.honba,
            riichiSticks: game.riichi.riichiSticks,
            doraIndicators: game.riichi.doraIndicators,
            ...(game.phase === "settled" ? { uraDoraIndicators: game.riichi.uraDoraIndicators } : {})
          }
        }
      : {}),
    ...(game.settlement ? { settlement: game.settlement } : {}),
    startedAt: game.startedAt,
    updatedAt: game.updatedAt
  };
}

export function getPrivateState(game: CoreGame, seatIndex: number): PrivatePlayerState {
  const player = getPlayer(game, seatIndex);
  const rawDrawnId = player.drawnTileId?.replace("supplement:", "");
  const tingHints = getTingHints(game, player);
  return {
    seatIndex,
    hand: orderPrivateHand(player.hand, rawDrawnId),
    legalActions: getLegalActions(game, seatIndex),
    winningTiles: getWinningTilesForPlayer(game, seatIndex),
    ...(rawDrawnId ? { drawnTileId: rawDrawnId } : {}),
    tingDiscardIds: tingHints.map((hint) => hint.discardTile.id),
    tingHints
  };
}

export function getLegalActions(game: CoreGame, seatIndex: number): LegalAction[] {
  if (game.phase !== "playing" && game.phase !== "claiming") {
    return [];
  }

  if (game.phase === "claiming") {
    return game.claimWindow?.options.find((option) => option.seatIndex === seatIndex)?.actions ?? [];
  }

  if (game.currentSeat !== seatIndex) {
    return [];
  }

  const player = getPlayer(game, seatIndex);
  const actions: LegalAction[] = [];

  if (canPlayerWin(game, player)) {
    actions.push({ type: "win", description: "自摸" });
  }

  for (const tile of legalDiscardTiles(player)) {
    actions.push({ type: "discard", tileId: tile.id, description: `打出 ${tile.label}` });
  }

  if (game.mode === "riichi" && !player.declaredRiichi && canDeclareRiichi(player)) {
    actions.push({ type: "declareRiichi", description: "立直" });
  }

  actions.push(...getCurrentPlayerKongActions(player));

  return actions;
}

export function applyDiscard(game: CoreGame, seatIndex: number, tileId: string): void {
  assertPlayingTurn(game, seatIndex);
  const player = getPlayer(game, seatIndex);
  const tile = removeTileById(player.hand, tileId);
  const rawDrawnId = player.drawnTileId?.replace("supplement:", "");
  if (player.declaredTing && rawDrawnId && tile.id !== rawDrawnId) {
    player.hand.push(tile);
    throw new Error("宣告聽牌後只能打出新摸進的牌。");
  }
  if (game.mode === "taiwan" && !isRonBlocked(player, tile)) {
    clearRonBlocks(player);
  }

  delete player.drawnTileId;
  player.discards.push(tile);
  const firstDiscardOfSeat = !player.firstDiscardMade;
  player.firstDiscardMade = true;
  game.lastDiscard = { seatIndex, tile, firstDiscardOfSeat };
  clearTurnTimer(game);

  const claimOptions = buildClaimOptions(game, tile, seatIndex);
  if (claimOptions.length === 0) {
    advanceTurnAndDraw(game, nextSeat(seatIndex));
    touch(game);
    return;
  }

  game.phase = "claiming";
  game.claimWindow = {
    id: createId("claim"),
    discard: tile,
    fromSeat: seatIndex,
    deadlineAt: Date.now() + game.config.claimWindowMs,
    options: claimOptions,
    passedSeatIndices: []
  };
  touch(game);
}

export function applyClaim(
  game: CoreGame,
  seatIndex: number,
  claimType: "chow" | "pong" | "kong" | "win" | "pass",
  tileIds: string[] = []
): void {
  if (game.phase !== "claiming" || !game.claimWindow) {
    throw new Error("目前沒有可回應的吃碰槓胡。");
  }

  const option = game.claimWindow.options.find((candidate) => candidate.seatIndex === seatIndex);
  if (!option) {
    throw new Error("你沒有此張牌的回應權。");
  }

  if (claimType === "pass") {
    passClaim(game, seatIndex);
    return;
  }

  const legalAction = option.actions.find((action) => action.type === claimType);
  if (!legalAction) {
    throw new Error("這個動作目前不合法。");
  }

  assertClaimPriority(game, seatIndex, claimType);

  if (claimType === "win") {
    settleWin(game, {
      winnerSeat: seatIndex,
      winMode: game.pendingRobKong ? "robKong" : "discard",
      winningTile: game.claimWindow.discard,
      fromSeat: game.claimWindow.fromSeat,
      responsibilitySeat: game.claimWindow.fromSeat,
      isFirstRoundWin: isHumanHand(game)
    });
    return;
  }

  const claimer = getPlayer(game, seatIndex);
  const claimedTile = game.claimWindow.discard;
  const fromSeat = game.claimWindow.fromSeat;
  removeLastDiscard(game, fromSeat, claimedTile.id);
  clearClaimStaleDraw(game, claimer);

  if (claimType === "pong") {
    const consumed = removeTilesByType(claimer.hand, claimedTile, 2);
    claimer.melds.push(createMeld("pong", [...consumed, claimedTile], claimedTile.id, fromSeat));
  } else if (claimType === "kong") {
    const consumed = removeTilesByType(claimer.hand, claimedTile, 3);
    claimer.melds.push(createMeld("exposedKong", [...consumed, claimedTile], claimedTile.id, fromSeat));
    drawSupplementTile(game, claimer, true);
    if (isTerminalPhase(game.phase)) {
      delete game.claimWindow;
      delete game.pendingRobKong;
      delete game.lastDiscard;
      touch(game);
      return;
    }
  } else {
    const consumed = consumeChowTiles(claimer.hand, claimedTile, tileIds);
    claimer.melds.push(createMeld("chow", [...consumed, claimedTile], claimedTile.id, fromSeat));
  }

  claimer.hand = sortTiles(claimer.hand);
  game.currentSeat = seatIndex;
  game.phase = "playing";
  delete game.claimWindow;
  delete game.pendingRobKong;
  delete game.lastDiscard;
  game.firstClaimOrMeldHappened = true;
  startTurnTimer(game);
  touch(game);
}

export function applySelfDrawWin(game: CoreGame, seatIndex: number): void {
  assertPlayingTurn(game, seatIndex);
  const player = getPlayer(game, seatIndex);
  if (!canPlayerWin(game, player)) {
    throw new Error("目前手牌尚未胡牌。");
  }
  const rawDrawnId = player.drawnTileId?.replace("supplement:", "");
  const winningTile = rawDrawnId ? player.hand.find((tile) => tile.id === rawDrawnId) : player.hand.at(-1);
  settleWin(game, {
    winnerSeat: seatIndex,
    winMode: "selfDraw",
    ...(winningTile ? { winningTile } : {}),
    isAfterKong: Boolean(player.drawnTileId?.startsWith("supplement:")),
    isLastTile: game.wall.length <= deadWallLimit(game),
    isInitialWin: seatIndex === game.dealerSeat && !player.firstDiscardMade && !player.firstDrawMade,
    isFirstDrawWin: seatIndex !== game.dealerSeat && player.firstDrawMade && !player.firstDiscardMade
  });
}

export function applyKong(game: CoreGame, seatIndex: number, tileIds: string[], meldId?: string): void {
  assertPlayingTurn(game, seatIndex);
  const player = getPlayer(game, seatIndex);

  if (meldId) {
    const meld = player.melds.find((candidate) => candidate.id === meldId && candidate.type === "pong");
    if (!meld) {
      throw new Error("找不到可加槓的碰牌。");
    }
    const baseTile = meld.tiles[0]!;
    const tile = removeTilesByType(player.hand, baseTile, 1)[0]!;
    if (game.mode === "taiwan" && !isRonBlocked(player, tile)) {
      clearRonBlocks(player);
    }
    const robOptions = buildRobKongOptions(game, tile, seatIndex);
    if (robOptions.length > 0) {
      game.phase = "claiming";
      clearTurnTimer(game);
      game.pendingRobKong = { fromSeat: seatIndex, tile, meldId };
      game.claimWindow = {
        id: createId("rob"),
        discard: tile,
        fromSeat: seatIndex,
        deadlineAt: Date.now() + game.config.claimWindowMs,
        options: robOptions,
        passedSeatIndices: []
      };
      touch(game);
      return;
    }
    meld.type = "addedKong";
    meld.tiles.push(tile);
    drawSupplementTile(game, player, true);
    if (game.phase === "playing") {
      startTurnTimer(game);
    }
    touch(game);
    return;
  }

  if (tileIds.length !== 4) {
    throw new Error("暗槓需要四張同牌。");
  }
  const tiles = tileIds.map((tileId) => removeTileById(player.hand, tileId));
  if (!tiles.every((tile) => sameTileType(tile, tiles[0]!))) {
    player.hand.push(...tiles);
    player.hand = sortTiles(player.hand);
    throw new Error("暗槓必須是四張相同牌。");
  }
  player.melds.push(createMeld("concealedKong", tiles, tiles[0]!.id, seatIndex, true));
  drawSupplementTile(game, player, true);
  if (game.phase === "playing") {
    startTurnTimer(game);
  }
  touch(game);
}

export function applyDeclareTing(game: CoreGame, seatIndex: number): void {
  assertPlayingTurn(game, seatIndex);
  if (game.mode !== "taiwan") {
    throw new Error("只有台灣麻將可以宣告聽牌。");
  }
  const player = getPlayer(game, seatIndex);
  if (player.declaredTing) {
    return;
  }
  if (!canDeclareTing(player)) {
    throw new Error("目前尚未聽牌，不能宣告聽牌。");
  }
  player.declaredTing = true;
  const noOneHasClaimed = !game.firstClaimOrMeldHappened && game.players.every((candidate) => candidate.melds.length === 0);
  const earlyDiscardCount = game.players.reduce((total, candidate) => total + candidate.discards.length, 0);
  if (noOneHasClaimed && !player.firstDiscardMade && player.melds.length === 0 && earlyDiscardCount <= 8) {
    if (player.seatIndex === game.dealerSeat) {
      player.declaredHeavenTing = true;
    } else {
      player.declaredEarthTing = true;
    }
  }
  touch(game);
}

export function applyDeclareRiichi(game: CoreGame, seatIndex: number): void {
  assertPlayingTurn(game, seatIndex);
  if (game.mode !== "riichi") {
    throw new Error("只有日式麻將可以立直。");
  }
  const player = getPlayer(game, seatIndex);
  if (player.declaredRiichi) {
    return;
  }
  if (!canDeclareRiichi(player)) {
    throw new Error("目前尚未聽牌，不能立直。");
  }
  if (player.coins < 1000) {
    throw new Error("點棒不足，不能立直。");
  }
  player.declaredRiichi = true;
  player.declaredTing = true;
  player.coins -= 1000;
  if (game.riichi) {
    game.riichi.riichiSticks += 1;
  }
  touch(game);
}

export function passExpiredClaimWindow(game: CoreGame, now = Date.now()): void {
  if (game.phase !== "claiming" || !game.claimWindow) {
    return;
  }
  if (now < game.claimWindow.deadlineAt + game.config.latencyGraceMs) {
    return;
  }
  for (const option of game.claimWindow.options) {
    if (!game.claimWindow.passedSeatIndices.includes(option.seatIndex)) {
      game.claimWindow.passedSeatIndices.push(option.seatIndex);
    }
  }
  finishClaimWindowIfAllPassed(game);
}

export function autoDiscardIfNeeded(game: CoreGame, seatIndex: number): void {
  if (game.phase !== "playing" || game.currentSeat !== seatIndex) {
    return;
  }
  const player = getPlayer(game, seatIndex);
  const tile = legalDiscardTiles(player).at(-1);
  if (tile) {
    applyDiscard(game, seatIndex, tile.id);
  }
}

export function passExpiredTurn(game: CoreGame, now = Date.now()): void {
  if (game.phase !== "playing" || !game.turnDeadlineAt) {
    return;
  }
  if (now < game.turnDeadlineAt + game.config.latencyGraceMs) {
    return;
  }
  autoDiscardIfNeeded(game, game.currentSeat);
}

export function autoRiichiDiscardIfNeeded(game: CoreGame, seatIndex: number): boolean {
  if (game.mode !== "riichi" || game.phase !== "playing" || game.currentSeat !== seatIndex) {
    return false;
  }

  const player = getPlayer(game, seatIndex);
  if (!player.declaredRiichi || !player.drawnTileId || canPlayerWin(game, player)) {
    return false;
  }

  const beforeDiscardCount = player.discards.length;
  autoDiscardIfNeeded(game, seatIndex);
  return player.discards.length > beforeDiscardCount || game.phase !== "playing" || game.currentSeat !== seatIndex;
}

function buildClaimOptions(game: CoreGame, discard: Tile, fromSeat: number): ClaimOption[] {
  const options: ClaimOption[] = [];
  for (const player of game.players) {
    if (player.seatIndex === fromSeat) {
      continue;
    }
    const actions: LegalAction[] = [];
    if (canPlayerWinWithTile(game, player, discard)) {
      actions.push({ type: "win", fromSeat, tileId: discard.id, description: `胡 ${discard.label}` });
    }
    if (!player.declaredRiichi && countSameType(player.hand, discard) >= 3) {
      actions.push({ type: "kong", fromSeat, tileId: discard.id, description: `槓 ${discard.label}` });
    }
    if (!player.declaredRiichi && countSameType(player.hand, discard) >= 2) {
      actions.push({ type: "pong", fromSeat, tileId: discard.id, description: `碰 ${discard.label}` });
    }
    if (!player.declaredRiichi && player.seatIndex === nextSeat(fromSeat)) {
      for (const chow of possibleChows(player.hand, discard)) {
        actions.push({
          type: "chow",
          fromSeat,
          tileId: discard.id,
          tileIds: chow.map((tile) => tile.id),
          description: `吃 ${chow.map((tile) => tile.label).join("")}${discard.label}`
        });
      }
    }
    if (actions.length > 0) {
      actions.push({ type: "pass", description: "過" });
      options.push({ seatIndex: player.seatIndex, actions });
    }
  }

  return options.sort((left, right) => seatDistance(fromSeat, left.seatIndex) - seatDistance(fromSeat, right.seatIndex));
}

function buildRobKongOptions(game: CoreGame, tile: Tile, fromSeat: number): ClaimOption[] {
  return game.players
    .filter((player) => player.seatIndex !== fromSeat && canPlayerWinWithTile(game, player, tile))
    .map((player) => ({
      seatIndex: player.seatIndex,
      actions: [
        { type: "win", fromSeat, tileId: tile.id, description: `搶槓 ${tile.label}` },
        { type: "pass", description: "過" }
      ]
    }));
}

function passClaim(game: CoreGame, seatIndex: number): void {
  if (!game.claimWindow) {
    return;
  }
  if (!game.claimWindow.passedSeatIndices.includes(seatIndex)) {
    game.claimWindow.passedSeatIndices.push(seatIndex);
  }
  finishClaimWindowIfAllPassed(game);
  touch(game);
}

function finishClaimWindowIfAllPassed(game: CoreGame): void {
  if (!game.claimWindow) {
    return;
  }
  const allPassed = game.claimWindow.options.every((option) => game.claimWindow!.passedSeatIndices.includes(option.seatIndex));
  if (!allPassed) {
    return;
  }

  applyPassedWinBlocks(game);

  if (game.pendingRobKong) {
    const player = getPlayer(game, game.pendingRobKong.fromSeat);
    const meld = player.melds.find((candidate) => candidate.id === game.pendingRobKong?.meldId);
    if (meld) {
      meld.type = "addedKong";
      meld.tiles.push(game.pendingRobKong.tile);
    }
    drawSupplementTile(game, player, true);
    delete game.pendingRobKong;
    delete game.claimWindow;
    if (game.phase === "settled" || game.phase === "draw") {
      touch(game);
      return;
    }
    game.phase = "playing";
    startTurnTimer(game);
    touch(game);
    return;
  }

  const next = nextSeat(game.claimWindow.fromSeat);
  delete game.claimWindow;
  advanceTurnAndDraw(game, next);
}

function assertClaimPriority(game: CoreGame, seatIndex: number, claimType: "chow" | "pong" | "kong" | "win"): void {
  if (!game.claimWindow) {
    return;
  }
  const priority = claimPriority(claimType);
  for (const option of game.claimWindow.options) {
    if (option.seatIndex === seatIndex || game.claimWindow.passedSeatIndices.includes(option.seatIndex)) {
      continue;
    }
    const highest = Math.max(...option.actions.map((action) => claimPriority(action.type)));
    if (highest > priority) {
      throw new Error("仍有更高優先權的回應尚未決定。");
    }
    if (highest === priority && seatDistance(game.claimWindow.fromSeat, option.seatIndex) < seatDistance(game.claimWindow.fromSeat, seatIndex)) {
      throw new Error("仍有較近順位的同優先權回應尚未決定。");
    }
  }
}

function claimPriority(type: LegalAction["type"]): number {
  if (type === "win") return 3;
  if (type === "pong" || type === "kong") return 2;
  if (type === "chow") return 1;
  return 0;
}

function isTerminalPhase(phase: GameState["phase"]): boolean {
  return phase === "settled" || phase === "draw";
}

function advanceTurnAndDraw(game: CoreGame, seatIndex: number): void {
  game.currentSeat = seatIndex;
  game.phase = "playing";
  if (game.wall.length <= deadWallLimit(game)) {
    settleDraw(game);
    return;
  }
  const player = getPlayer(game, seatIndex);
  drawNormalTile(game, player);
  player.firstDrawMade = true;
  if (game.phase === "playing") {
    startTurnTimer(game);
  }
  touch(game);
}

function drawNormalTile(game: CoreGame, player: CorePlayer): void {
  while (game.wall.length > deadWallLimit(game)) {
    const tile = game.wall.shift();
    if (!tile) {
      break;
    }
    if (game.mode === "taiwan" && tile.kind === "flower") {
      player.flowers.push(tile);
      if (resolveFlowerDrawWin(game, player, tile)) {
        return;
      }
      drawSupplementTile(game, player, true);
      continue;
    }
    player.hand.push(tile);
    player.drawnTileId = tile.id;
    player.hand = sortTiles(player.hand);
    return;
  }
  settleDraw(game);
}

function drawSupplementTile(game: CoreGame, player: CorePlayer, afterKong: boolean): void {
  while (game.wall.length > deadWallLimit(game)) {
    const tile = game.wall.pop();
    if (!tile) {
      break;
    }
    if (game.mode === "taiwan" && tile.kind === "flower") {
      player.flowers.push(tile);
      if (resolveFlowerDrawWin(game, player, tile)) {
        return;
      }
      continue;
    }
    player.hand.push(tile);
    player.drawnTileId = afterKong ? `supplement:${tile.id}` : tile.id;
    player.hand = sortTiles(player.hand);
    return;
  }
  settleDraw(game);
}

function drawUntilNonFlowerCount(game: CoreGame, player: CorePlayer, targetCount: number, initialDraw: boolean): void {
  while (player.hand.length < targetCount && game.wall.length > deadWallLimit(game)) {
    const tile = initialDraw ? game.wall.shift() : game.wall.pop();
    if (!tile) {
      return;
    }
    if (game.mode === "taiwan" && tile.kind === "flower") {
      player.flowers.push(tile);
      continue;
    }
    player.hand.push(tile);
  }
}

function resolveImmediateFlowerWin(game: CoreGame, initialWin: boolean): void {
  const winner = game.players.find((player) => player.flowers.length >= 8);
  if (!winner) {
    return;
  }
  settleWin(game, {
    winnerSeat: winner.seatIndex,
    winMode: "eightFlowers",
    isInitialWin: initialWin
  });
}

function resolveFlowerDrawWin(game: CoreGame, drawingPlayer: CorePlayer, flowerTile: Tile): boolean {
  const robber = game.players
    .filter((player) => player.seatIndex !== drawingPlayer.seatIndex && player.flowers.length === 7)
    .sort((left, right) => seatDistance(drawingPlayer.seatIndex, left.seatIndex) - seatDistance(drawingPlayer.seatIndex, right.seatIndex))[0];
  if (robber) {
    settleWin(game, {
      winnerSeat: robber.seatIndex,
      winMode: "sevenFlowersRob",
      winningTile: flowerTile,
      fromSeat: drawingPlayer.seatIndex,
      responsibilitySeat: drawingPlayer.seatIndex
    });
    return true;
  }

  if (drawingPlayer.flowers.length >= 8) {
    settleWin(game, {
      winnerSeat: drawingPlayer.seatIndex,
      winMode: "eightFlowers",
      winningTile: flowerTile
    });
    return true;
  }

  return false;
}

function settleWin(game: CoreGame, context: WinContext): void {
  const settlement =
    game.mode === "riichi"
      ? calculateRiichiScore(
          game.players.map((player) => ({
            seatIndex: player.seatIndex,
            wind: player.wind,
            hand: player.hand,
            melds: player.melds,
            declaredRiichi: player.declaredRiichi
          })),
          {
            handId: game.handId,
            dealerSeat: game.dealerSeat,
            roundWind: game.roundWind,
            honba: game.riichi?.honba ?? 0,
            riichiSticks: game.riichi?.riichiSticks ?? 0,
            doraIndicators: game.riichi?.doraIndicators ?? [],
            uraDoraIndicators: game.riichi?.uraDoraIndicators ?? []
          },
          context
        )
      : calculateScore(
          game.players.map(toScoringPlayer),
          {
            handId: game.handId,
            dealerSeat: game.dealerSeat,
            roundWind: game.roundWind,
            dealerStreak: game.dealerStreak,
            config: game.config
          },
          context
        );
  for (const payment of settlement.payments) {
    game.players[payment.fromSeat]!.coins -= payment.amount;
    game.players[payment.toSeat]!.coins += payment.amount;
  }
  if (game.mode === "riichi" && game.riichi) {
    game.riichi.riichiSticks = 0;
  }
  const winner = getPlayer(game, context.winnerSeat);
  game.settlement = {
    ...settlement,
    winnerHand: buildSettlementHand(winner, context),
    winnerMelds: publicMelds(winner.melds)
  };
  game.phase = "settled";
  clearTurnTimer(game);
  delete game.claimWindow;
  delete game.pendingRobKong;
  touch(game);
}

function settleDraw(game: CoreGame): void {
  game.phase = "draw";
  clearTurnTimer(game);
  delete game.claimWindow;
  delete game.pendingRobKong;

  const tenpaiSeats = game.players.filter((player) => getWinningTilesForHand(game, player.hand, player.melds).length > 0).map((player) => player.seatIndex);
  const notenSeats = game.players.filter((player) => !tenpaiSeats.includes(player.seatIndex)).map((player) => player.seatIndex);

  if (game.mode === "riichi") {
    const payments = buildNotenPayments(tenpaiSeats, notenSeats);
    for (const payment of payments) {
      game.players[payment.fromSeat]!.coins -= payment.amount;
      game.players[payment.toSeat]!.coins += payment.amount;
    }
    game.settlement = {
      handId: game.handId,
      winMode: "draw",
      drawReason: "荒牌流局",
      tenpaiSeats,
      notenSeats,
      baseTai: 0,
      patterns: payments.length > 0 ? [{ id: "noten-payment", name: "不聽罰符", tai: 0 }] : [],
      payments,
      totalGain: 0
    };
  } else {
    game.settlement = {
      handId: game.handId,
      winMode: "draw",
      drawReason: "荒牌流局",
      tenpaiSeats,
      notenSeats,
      baseTai: 0,
      patterns: [],
      payments: [],
      totalGain: 0
    };
  }

  touch(game);
}

function toScoringPlayer(player: CorePlayer): ScoringPlayer {
  return {
    seatIndex: player.seatIndex,
    wind: player.wind,
    hand: player.hand,
    flowers: player.flowers,
    melds: player.melds,
    declaredTing: player.declaredTing,
    declaredHeavenTing: player.declaredHeavenTing,
    declaredEarthTing: player.declaredEarthTing
  };
}

function buildSettlementHand(winner: CorePlayer, context: WinContext): Tile[] {
  const rawDrawnId = winner.drawnTileId?.replace("supplement:", "");
  const hand = context.winMode === "selfDraw" ? winner.hand : appendWinningTileIfNeeded(winner.hand, context.winningTile);
  return orderWinningHandGroups(hand, winner.melds, context.winningTile) ?? orderPrivateHand(hand, rawDrawnId);
}

function appendWinningTileIfNeeded(hand: Tile[], winningTile: Tile | undefined): Tile[] {
  if (!winningTile || hand.some((tile) => tile.id === winningTile.id)) {
    return hand;
  }
  return [...hand, winningTile];
}

function isHumanHand(game: CoreGame): boolean {
  if (!game.lastDiscard) {
    return false;
  }
  return !game.firstClaimOrMeldHappened && game.lastDiscard.firstDiscardOfSeat && game.players.every((player) => player.discards.length <= 1);
}

function canPlayerWin(game: CoreGame, player: CorePlayer): boolean {
  if (!hasSelfDrawOpportunity(game, player)) {
    return false;
  }
  const rawDrawnId = player.drawnTileId?.replace("supplement:", "");
  const winningTile = rawDrawnId ? player.hand.find((tile) => tile.id === rawDrawnId) : player.hand.at(-1);
  if (!winningTile) {
    return false;
  }

  if (game.mode === "riichi") {
    return canRiichiWin(player.hand, player.melds, winningTile, { winMode: "selfDraw" });
  }
  if (isRonBlocked(player, winningTile)) {
    return false;
  }
  return canWin(player.hand, player.melds);
}

function hasSelfDrawOpportunity(game: CoreGame, player: CorePlayer): boolean {
  if (player.drawnTileId) {
    return true;
  }
  return (
    player.seatIndex === game.dealerSeat &&
    game.currentSeat === player.seatIndex &&
    !player.firstDiscardMade &&
    !player.firstDrawMade &&
    player.discards.length === 0 &&
    player.melds.length === 0
  );
}

function canPlayerWinWithTile(game: CoreGame, player: CorePlayer, tile: Tile): boolean {
  if (game.mode === "riichi") {
    if (isDiscardFuriten(game, player, tile)) {
      return false;
    }
    return canRiichiWin([...player.hand, tile], player.melds, tile, { winMode: "discard" });
  }
  if (isRonBlocked(player, tile)) {
    return false;
  }
  return canWinWithTile(player.hand, tile, player.melds);
}

function isDiscardFuriten(game: CoreGame, player: CorePlayer, targetTile: Tile): boolean {
  if (game.mode !== "riichi") {
    return false;
  }
  const winningKeys = new Set(getWinningTilesForHand(game, player.hand, player.melds).map(tileKey));
  if (!winningKeys.has(tileKey(targetTile))) {
    return false;
  }
  return player.discards.some((discard) => winningKeys.has(tileKey(discard)));
}

function buildNotenPayments(tenpaiSeats: number[], notenSeats: number[]): ScoringResult["payments"] {
  if (tenpaiSeats.length === 0 || notenSeats.length === 0) {
    return [];
  }
  const amountPerPair = 3000 / (tenpaiSeats.length * notenSeats.length);
  return notenSeats.flatMap((fromSeat) =>
    tenpaiSeats.map((toSeat) => ({
      fromSeat,
      toSeat,
      amount: amountPerPair,
      tai: 0,
      reason: "不聽罰符"
    }))
  );
}

function applyPassedWinBlocks(game: CoreGame): void {
  if (game.mode !== "taiwan" || !game.claimWindow) {
    return;
  }
  for (const option of game.claimWindow.options) {
    if (!game.claimWindow.passedSeatIndices.includes(option.seatIndex)) {
      continue;
    }
    if (!option.actions.some((action) => action.type === "win")) {
      continue;
    }
    const player = getPlayer(game, option.seatIndex);
    const blockedKeys = getWinningTiles(player.hand, player.melds).map(tileKey);
    if (blockedKeys.length > 0) {
      player.ronBlockedTileKeys = [...new Set([...player.ronBlockedTileKeys, ...blockedKeys])];
    }
  }
}

function clearRonBlocks(player: CorePlayer): void {
  player.ronBlockedTileKeys = [];
}

function isRonBlocked(player: CorePlayer, tile: Tile): boolean {
  return player.ronBlockedTileKeys.includes(tileKey(tile));
}

function canDeclareTing(player: CorePlayer): boolean {
  if (isTing(player.hand, player.melds)) {
    return true;
  }
  return player.hand.some((tile) => {
    const remaining = player.hand.filter((candidate) => candidate.id !== tile.id);
    return isTing(remaining, player.melds);
  });
}

function canDeclareRiichi(player: CorePlayer): boolean {
  if (player.melds.some((meld) => !meld.concealed)) {
    return false;
  }
  return riichiShanten(player.hand, player.melds) <= 0;
}

function orderPrivateHand(hand: Tile[], rawDrawnId?: string): Tile[] {
  if (!rawDrawnId) {
    return sortTiles(hand);
  }
  const drawnTile = hand.find((tile) => tile.id === rawDrawnId);
  if (!drawnTile) {
    return sortTiles(hand);
  }
  return [...sortTiles(hand.filter((tile) => tile.id !== rawDrawnId)), drawnTile];
}

function getTingHints(game: CoreGame, player: CorePlayer): PrivatePlayerState["tingHints"] {
  if (game.phase !== "playing" || game.currentSeat !== player.seatIndex) {
    return [];
  }

  const hints: PrivatePlayerState["tingHints"] = [];
  for (const tile of legalDiscardTiles(player)) {
    const remaining = removeOneTileById(player.hand, tile.id);
    const winningTiles = getWinningTilesForHand(game, remaining, player.melds);
    if (winningTiles.length > 0) {
      hints.push({ discardTile: tile, winningTiles });
    }
  }
  return hints;
}

function getCurrentPlayerKongActions(player: CorePlayer): LegalAction[] {
  if (player.declaredRiichi) {
    return [];
  }

  const actions: LegalAction[] = [];
  const byKey = new Map<string, Tile[]>();
  for (const tile of player.hand) {
    const key = tileKey(tile);
    const bucket = byKey.get(key) ?? [];
    bucket.push(tile);
    byKey.set(key, bucket);
  }
  for (const tiles of byKey.values()) {
    if (tiles.length === 4) {
      actions.push({ type: "kong", tileIds: tiles.map((tile) => tile.id), description: `暗槓 ${tiles[0]!.label}` });
    }
  }

  for (const meld of player.melds) {
    if (meld.type !== "pong") {
      continue;
    }
    const baseTile = meld.tiles[0];
    if (!baseTile) {
      continue;
    }
    const addTile = player.hand.find((tile) => sameTileType(tile, baseTile));
    if (addTile) {
      actions.push({ type: "kong", tileIds: [addTile.id], meldId: meld.id, description: `加槓 ${baseTile.label}` });
    }
  }

  return actions;
}

function getWinningTilesForPlayer(game: CoreGame, seatIndex: number): Tile[] {
  const player = getPlayer(game, seatIndex);
  if (game.phase === "playing" && game.currentSeat === seatIndex && canPlayerWin(game, player)) {
    return [];
  }
  if (game.phase === "playing" && game.currentSeat === seatIndex) {
    const waits: Tile[] = [];
    for (const tile of legalDiscardTiles(player)) {
      waits.push(...getWinningTilesForHand(game, removeOneTileById(player.hand, tile.id), player.melds));
    }
    return dedupeTilesByKey(waits);
  }
  return getWinningTilesForHand(game, player.hand, player.melds);
}

function getWinningTilesForHand(game: CoreGame, hand: Tile[], melds: Meld[]): Tile[] {
  if (game.mode === "riichi") {
    return getRiichiWinningTiles(
      hand,
      melds,
      allPlayableTileKeys().map((key) => createTileFromKey(key))
    );
  }
  return getWinningTiles(hand, melds);
}

function dedupeTilesByKey(tiles: Tile[]): Tile[] {
  const seen = new Set<string>();
  const unique: Tile[] = [];
  for (const tile of tiles) {
    const key = tileKey(tile);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(tile);
    }
  }
  return sortTiles(unique);
}

function removeOneTileById(tiles: Tile[], tileId: string): Tile[] {
  let removed = false;
  return tiles.filter((tile) => {
    if (!removed && tile.id === tileId) {
      removed = true;
      return false;
    }
    return true;
  });
}

function legalDiscardTiles(player: CorePlayer): Tile[] {
  if (!player.declaredTing || !player.drawnTileId) {
    return sortTiles(player.hand);
  }
  const rawDrawnId = player.drawnTileId.replace("supplement:", "");
  return player.hand.filter((tile) => tile.id === rawDrawnId);
}

function clearClaimStaleDraw(game: CoreGame, player: CorePlayer): void {
  const rawDrawnId = player.drawnTileId?.replace("supplement:", "");
  if (!rawDrawnId) {
    return;
  }

  const expectedWaitingCount = waitingHandCount(game, player);
  if (player.hand.length > expectedWaitingCount) {
    const staleDrawIndex = player.hand.findIndex((tile) => tile.id === rawDrawnId);
    if (staleDrawIndex >= 0) {
      player.hand.splice(staleDrawIndex, 1);
    }
  }
  delete player.drawnTileId;
}

function waitingHandCount(game: CoreGame, player: CorePlayer): number {
  const baseCount = game.mode === "riichi" ? 13 : 16;
  return baseCount - player.melds.length * 3;
}

function deadWallLimit(game: CoreGame): number {
  return game.mode === "riichi" ? 14 : 16;
}

function consumeChowTiles(hand: Tile[], claimedTile: Tile, tileIds: string[]): Tile[] {
  if (tileIds.length !== 2) {
    throw new Error("吃牌需要指定兩張手牌。");
  }
  const consumed = tileIds.map((tileId) => removeTileById(hand, tileId));
  const options = possibleChows([...hand, ...consumed], claimedTile);
  const selectedKeys = consumed.map(tileKey).sort().join("|");
  if (!options.some((option) => option.map(tileKey).sort().join("|") === selectedKeys)) {
    hand.push(...consumed);
    throw new Error("指定的吃牌組合不合法。");
  }
  return consumed;
}

function removeTilesByType(hand: Tile[], target: Tile, count: number): Tile[] {
  const removed: Tile[] = [];
  for (let index = hand.length - 1; index >= 0 && removed.length < count; index -= 1) {
    const tile = hand[index]!;
    if (sameTileType(tile, target)) {
      removed.push(tile);
      hand.splice(index, 1);
    }
  }
  if (removed.length !== count) {
    hand.push(...removed);
    throw new Error(`手牌中沒有足夠的 ${target.label}。`);
  }
  return removed;
}

function removeTileById(hand: Tile[], tileId: string): Tile {
  const index = hand.findIndex((tile) => tile.id === tileId);
  if (index < 0) {
    throw new Error("找不到指定的牌。");
  }
  return hand.splice(index, 1)[0]!;
}

function removeLastDiscard(game: CoreGame, seatIndex: number, tileId: string): void {
  const player = getPlayer(game, seatIndex);
  let index = -1;
  for (let candidateIndex = player.discards.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
    if (player.discards[candidateIndex]?.id === tileId) {
      index = candidateIndex;
      break;
    }
  }
  if (index >= 0) {
    player.discards.splice(index, 1);
  }
}

function countSameType(hand: Tile[], target: Tile): number {
  return hand.filter((tile) => sameTileType(tile, target)).length;
}

function getPlayer(game: CoreGame, seatIndex: number): CorePlayer {
  const player = game.players[seatIndex];
  if (!player) {
    throw new Error(`找不到座位 ${seatIndex}。`);
  }
  return player;
}

function assertPlayingTurn(game: CoreGame, seatIndex: number): void {
  if (game.phase !== "playing") {
    throw new Error("牌局目前不能執行此動作。");
  }
  if (game.currentSeat !== seatIndex) {
    throw new Error("還沒輪到你。");
  }
}

function createMeld(
  type: Meld["type"],
  tiles: Tile[],
  claimedTileId: string,
  fromSeat: number,
  concealed = false
): Meld {
  return {
    id: createId("meld"),
    type,
    tiles: sortTiles(tiles),
    claimedTileId,
    fromSeat,
    concealed
  };
}

function publicMelds(melds: Meld[]): Meld[] {
  return melds.map((meld) => {
    if (meld.concealed) {
      return {
        ...meld,
        tiles: meld.tiles.map((tile, index) => (index === 0 || index === meld.tiles.length - 1 ? tile : { ...tile, label: "暗" }))
      };
    }
    return meld;
  });
}

function startTurnTimer(game: CoreGame): void {
  if (game.phase !== "playing") {
    clearTurnTimer(game);
    return;
  }
  game.turnDeadlineAt = Date.now() + game.config.autoDiscardMs;
}

function clearTurnTimer(game: CoreGame): void {
  delete game.turnDeadlineAt;
}

function touch(game: CoreGame): void {
  game.updatedAt = Date.now();
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
