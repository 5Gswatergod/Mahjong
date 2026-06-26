import {
  DEFAULT_GAME_CONFIG,
  type ClaimOption,
  type ClaimWindow,
  type GameConfig,
  type GameState,
  type LegalAction,
  type Meld,
  type PlayerSeat,
  type PrivatePlayerState,
  type ScoringResult,
  type Tile,
  type WinContext,
  type Wind,
  type WinMode,
  winds
} from "@taiwan-mahjong/shared";
import { canWin, canWinWithTile, getWinningTiles, isTing, possibleChows } from "./hand.js";
import { calculateScore, type ScoringPlayer, type ScoringTable } from "./scoring.js";
import { buildWall, nextSeat, sameTileType, seatDistance, shuffleTiles, sortTiles, tileKey } from "./tiles.js";

export interface CorePlayer {
  seatIndex: number;
  wind: Wind;
  playerId?: string;
  name?: string;
  coins: number;
  ready: boolean;
  connected: boolean;
  hand: Tile[];
  flowers: Tile[];
  melds: Meld[];
  discards: Tile[];
  declaredTing: boolean;
  declaredEarthTing: boolean;
  firstDiscardMade: boolean;
  firstDrawMade: boolean;
  drawnTileId?: string;
}

export interface CoreGame {
  id: string;
  handId: string;
  phase: GameState["phase"];
  config: GameConfig;
  dealerSeat: number;
  currentSeat: number;
  roundWind: Wind;
  dealerStreak: number;
  wall: Tile[];
  players: CorePlayer[];
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
  config?: Partial<GameConfig>;
  dealerSeat?: number;
  roundWind?: Wind;
  dealerStreak?: number;
  random?: () => number;
}

export function createGame(seats: PlayerSeat[], options: CreateGameOptions = {}): CoreGame {
  const dealerSeat = options.dealerSeat ?? 0;
  const startedAt = Date.now();
  const players: CorePlayer[] = seats.map((seat) => ({
    seatIndex: seat.seatIndex,
    wind: winds[(seat.seatIndex - dealerSeat + 4) % 4]!,
    ...(seat.playerId ? { playerId: seat.playerId } : {}),
    ...(seat.name ? { name: seat.name } : {}),
    coins: seat.coins,
    ready: seat.ready,
    connected: seat.connected,
    hand: [],
    flowers: [],
    melds: [],
    discards: [],
    declaredTing: false,
    declaredEarthTing: false,
    firstDiscardMade: false,
    firstDrawMade: false
  }));

  const game: CoreGame = {
    id: options.id ?? createId("game"),
    handId: options.handId ?? createId("hand"),
    phase: "playing",
    config: { ...DEFAULT_GAME_CONFIG, ...options.config },
    dealerSeat,
    currentSeat: dealerSeat,
    roundWind: options.roundWind ?? "east",
    dealerStreak: options.dealerStreak ?? 0,
    wall: shuffleTiles(buildWall(), options.random),
    players,
    firstClaimOrMeldHappened: false,
    startedAt,
    updatedAt: startedAt
  };

  for (const player of game.players) {
    const targetCount = player.seatIndex === dealerSeat ? 17 : 16;
    drawUntilNonFlowerCount(game, player, targetCount, true);
    player.hand = sortTiles(player.hand);
  }

  resolveImmediateFlowerWin(game, true);
  touch(game);
  return game;
}

export function toPublicGameState(game: CoreGame): GameState {
  return {
    id: game.id,
    handId: game.handId,
    phase: game.phase,
    config: game.config,
    dealerSeat: game.dealerSeat,
    currentSeat: game.currentSeat,
    roundWind: game.roundWind,
    dealerStreak: game.dealerStreak,
    wallCount: game.wall.length,
    deadWallCount: Math.min(16, game.wall.length),
    ...(game.lastDiscard
      ? { lastDiscard: { seatIndex: game.lastDiscard.seatIndex, tile: game.lastDiscard.tile } }
      : {}),
    ...(game.claimWindow ? { claimWindow: game.claimWindow } : {}),
    players: game.players.map((player) => ({
      seatIndex: player.seatIndex,
      wind: player.wind,
      ...(player.playerId ? { playerId: player.playerId } : {}),
      ...(player.name ? { name: player.name } : {}),
      coins: player.coins,
      ready: player.ready,
      connected: player.connected,
      handCount: player.hand.length,
      flowerTiles: player.flowers,
      melds: publicMelds(player.melds),
      discards: player.discards,
      declaredTing: player.declaredTing
    })),
    ...(game.settlement ? { settlement: game.settlement } : {}),
    startedAt: game.startedAt,
    updatedAt: game.updatedAt
  };
}

export function getPrivateState(game: CoreGame, seatIndex: number): PrivatePlayerState {
  const player = getPlayer(game, seatIndex);
  return {
    seatIndex,
    hand: sortTiles(player.hand),
    legalActions: getLegalActions(game, seatIndex),
    winningTiles: getWinningTilesForPlayer(game, seatIndex)
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

  if (canWin(player.hand, player.melds)) {
    actions.push({ type: "win", description: "自摸" });
  }

  for (const tile of legalDiscardTiles(player)) {
    actions.push({ type: "discard", tileId: tile.id, description: `打出 ${tile.label}` });
  }

  if (!player.declaredTing && canDeclareTing(player)) {
    actions.push({ type: "declareTing", description: "宣告聽牌" });
  }

  for (const tileIds of getCurrentPlayerKongOptions(player)) {
    actions.push({ type: "kong", tileIds, description: "槓" });
  }

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

  delete player.drawnTileId;
  player.discards.push(tile);
  const firstDiscardOfSeat = !player.firstDiscardMade;
  player.firstDiscardMade = true;
  game.lastDiscard = { seatIndex, tile, firstDiscardOfSeat };

  const claimOptions = buildClaimOptions(game, tile, seatIndex);
  if (claimOptions.length === 0) {
    delete game.lastDiscard;
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

  if (claimType === "pong") {
    const consumed = removeTilesByType(claimer.hand, claimedTile, 2);
    claimer.melds.push(createMeld("pong", [...consumed, claimedTile], claimedTile.id, fromSeat));
  } else if (claimType === "kong") {
    const consumed = removeTilesByType(claimer.hand, claimedTile, 3);
    claimer.melds.push(createMeld("exposedKong", [...consumed, claimedTile], claimedTile.id, fromSeat));
    drawSupplementTile(game, claimer, true);
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
  touch(game);
}

export function applySelfDrawWin(game: CoreGame, seatIndex: number): void {
  assertPlayingTurn(game, seatIndex);
  const player = getPlayer(game, seatIndex);
  if (!canWin(player.hand, player.melds)) {
    throw new Error("目前手牌尚未胡牌。");
  }
  const rawDrawnId = player.drawnTileId?.replace("supplement:", "");
  const winningTile = rawDrawnId ? player.hand.find((tile) => tile.id === rawDrawnId) : player.hand.at(-1);
  settleWin(game, {
    winnerSeat: seatIndex,
    winMode: "selfDraw",
    ...(winningTile ? { winningTile } : {}),
    isAfterKong: Boolean(player.drawnTileId?.startsWith("supplement:")),
    isLastTile: game.wall.length <= 16,
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
    const robOptions = buildRobKongOptions(game, tile, seatIndex);
    if (robOptions.length > 0) {
      game.phase = "claiming";
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
  touch(game);
}

export function applyDeclareTing(game: CoreGame, seatIndex: number): void {
  assertPlayingTurn(game, seatIndex);
  const player = getPlayer(game, seatIndex);
  if (player.declaredTing) {
    return;
  }
  if (!canDeclareTing(player)) {
    throw new Error("目前尚未聽牌，不能宣告聽牌。");
  }
  player.declaredTing = true;
  const noOneHasClaimed = !game.firstClaimOrMeldHappened && game.players.every((candidate) => candidate.melds.length === 0);
  if (noOneHasClaimed && !player.firstDiscardMade && player.melds.length === 0) {
    player.declaredEarthTing = true;
  }
  touch(game);
}

export function passExpiredClaimWindow(game: CoreGame): void {
  if (game.phase !== "claiming" || !game.claimWindow) {
    return;
  }
  if (Date.now() < game.claimWindow.deadlineAt) {
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

function buildClaimOptions(game: CoreGame, discard: Tile, fromSeat: number): ClaimOption[] {
  const options: ClaimOption[] = [];
  for (const player of game.players) {
    if (player.seatIndex === fromSeat) {
      continue;
    }
    const actions: LegalAction[] = [];
    if (canWinWithTile(player.hand, discard, player.melds)) {
      actions.push({ type: "win", fromSeat, tileId: discard.id, description: `胡 ${discard.label}` });
    }
    if (countSameType(player.hand, discard) >= 3) {
      actions.push({ type: "kong", fromSeat, tileId: discard.id, description: `槓 ${discard.label}` });
    }
    if (countSameType(player.hand, discard) >= 2) {
      actions.push({ type: "pong", fromSeat, tileId: discard.id, description: `碰 ${discard.label}` });
    }
    if (player.seatIndex === nextSeat(fromSeat)) {
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
    .filter((player) => player.seatIndex !== fromSeat && canWinWithTile(player.hand, tile, player.melds))
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
    game.phase = "playing";
    touch(game);
    return;
  }

  const next = nextSeat(game.claimWindow.fromSeat);
  delete game.claimWindow;
  delete game.lastDiscard;
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

function advanceTurnAndDraw(game: CoreGame, seatIndex: number): void {
  game.currentSeat = seatIndex;
  game.phase = "playing";
  if (game.wall.length <= 16) {
    game.phase = "draw";
    touch(game);
    return;
  }
  const player = getPlayer(game, seatIndex);
  drawNormalTile(game, player);
  player.firstDrawMade = true;
  touch(game);
}

function drawNormalTile(game: CoreGame, player: CorePlayer): void {
  while (game.wall.length > 16) {
    const tile = game.wall.shift();
    if (!tile) {
      break;
    }
    if (tile.kind === "flower") {
      player.flowers.push(tile);
      if (resolveFlowerDrawWin(game, player, tile)) {
        return;
      }
      drawSupplementTile(game, player, false);
      continue;
    }
    player.hand.push(tile);
    player.drawnTileId = tile.id;
    player.hand = sortTiles(player.hand);
    return;
  }
  game.phase = "draw";
}

function drawSupplementTile(game: CoreGame, player: CorePlayer, afterKong: boolean): void {
  while (game.wall.length > 16) {
    const tile = game.wall.pop();
    if (!tile) {
      break;
    }
    if (tile.kind === "flower") {
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
  game.phase = "draw";
}

function drawUntilNonFlowerCount(game: CoreGame, player: CorePlayer, targetCount: number, initialDraw: boolean): void {
  while (player.hand.length < targetCount && game.wall.length > 16) {
    const tile = initialDraw ? game.wall.shift() : game.wall.pop();
    if (!tile) {
      return;
    }
    if (tile.kind === "flower") {
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
  const table: ScoringTable = {
    handId: game.handId,
    dealerSeat: game.dealerSeat,
    roundWind: game.roundWind,
    dealerStreak: game.dealerStreak,
    config: game.config
  };
  const players = game.players.map(toScoringPlayer);
  const settlement = calculateScore(players, table, context);
  for (const payment of settlement.payments) {
    game.players[payment.fromSeat]!.coins -= payment.amount;
    game.players[payment.toSeat]!.coins += payment.amount;
  }
  game.settlement = settlement;
  game.phase = "settled";
  delete game.claimWindow;
  delete game.pendingRobKong;
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
    declaredEarthTing: player.declaredEarthTing
  };
}

function isHumanHand(game: CoreGame): boolean {
  if (!game.lastDiscard) {
    return false;
  }
  return !game.firstClaimOrMeldHappened && game.lastDiscard.firstDiscardOfSeat && game.players.every((player) => player.discards.length <= 1);
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

function getCurrentPlayerKongOptions(player: CorePlayer): string[][] {
  const options: string[][] = [];
  const byKey = new Map<string, Tile[]>();
  for (const tile of player.hand) {
    const key = tileKey(tile);
    const bucket = byKey.get(key) ?? [];
    bucket.push(tile);
    byKey.set(key, bucket);
  }
  for (const tiles of byKey.values()) {
    if (tiles.length === 4) {
      options.push(tiles.map((tile) => tile.id));
    }
  }
  return options;
}

function getWinningTilesForPlayer(game: CoreGame, seatIndex: number): Tile[] {
  const player = getPlayer(game, seatIndex);
  if (game.phase === "playing" && game.currentSeat === seatIndex && canWin(player.hand, player.melds)) {
    return [];
  }
  return getWinningTiles(player.hand, player.melds);
}

function legalDiscardTiles(player: CorePlayer): Tile[] {
  if (!player.declaredTing || !player.drawnTileId) {
    return sortTiles(player.hand);
  }
  const rawDrawnId = player.drawnTileId.replace("supplement:", "");
  return player.hand.filter((tile) => tile.id === rawDrawnId);
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

function touch(game: CoreGame): void {
  game.updatedAt = Date.now();
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
