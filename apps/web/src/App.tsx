import {
  Bot,
  Check,
  Copy,
  Crown,
  DoorOpen,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Shuffle,
  Sparkles,
  Trophy,
  UserPlus,
  UserX,
  Users,
  WifiOff,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  type ClientToServerEvents,
  type GameMode,
  type GameState,
  type GuestAuthResponse,
  type LegalAction,
  type PrivatePlayerState,
  type PublicPlayerState,
  type RoomSnapshot,
  type ScoringResult,
  type ServerToClientEvents,
  type Tile,
  type Wind
} from "@taiwan-mahjong/shared";
import { tileImagePath } from "./tileAssets";

type MahjongSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const sessionStorageKey = "mahjong.guestSession";

const modeLabels: Record<GameMode, string> = {
  taiwan: "台灣 16 張",
  riichi: "日式立直"
};

const windLabels: Record<Wind, string> = {
  east: "東",
  south: "南",
  west: "西",
  north: "北"
};

const windFullLabels: Record<Wind, string> = {
  east: "東風",
  south: "南風",
  west: "西風",
  north: "北風"
};

class AuthExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthExpiredError";
  }
}

export function App() {
  const [session, setSession] = useState<GuestAuthResponse | null>(() => readSession());
  const [guestName, setGuestName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [selectedMode, setSelectedMode] = useState<GameMode>("taiwan");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [privateState, setPrivateState] = useState<PrivatePlayerState | null>(null);
  const [actions, setActions] = useState<LegalAction[]>([]);
  const [settlement, setSettlement] = useState<ScoringResult | null>(null);
  const [socket, setSocket] = useState<MahjongSocket | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [dismissedSettlementHandId, setDismissedSettlementHandId] = useState<string | null>(null);

  const mySeat = useMemo(() => {
    if (!room || !session) return undefined;
    return room.seats.find((seat) => seat.playerId === session.playerId);
  }, [room, session]);

  const myTurn = game?.phase === "playing" && game.currentSeat === mySeat?.seatIndex;
  const claimActions = actions.filter((action) => ["win", "chow", "pong", "kong", "pass"].includes(action.type));
  const commandActions = actions.filter((action) => ["win", "kong", "declareTing", "declareRiichi"].includes(action.type));
  const visibleActions = claimActions.length > 0 ? claimActions : commandActions;
  const handSignature = privateState?.hand.map((tile) => tile.id).join("|") ?? "";
  const settlementResult = settlement ?? game?.settlement ?? null;
  const showSettlement = Boolean(settlementResult && dismissedSettlementHandId !== settlementResult.handId);
  const canManageSeats = Boolean(
    room &&
      session &&
      room.hostPlayerId === session.playerId &&
      (!game || game.phase === "settled" || game.phase === "draw" || game.phase === "waiting")
  );

  const discardableIds = useMemo(
    () => new Set(actions.filter((action) => action.type === "discard").map((action) => action.tileId).filter(Boolean) as string[]),
    [actions]
  );
  const tingDiscardIds = useMemo(() => new Set(privateState?.tingDiscardIds ?? []), [privateState?.tingDiscardIds]);
  const actionHintIds = useMemo(
    () => buildActionHintIds(actions, privateState?.hand ?? [], game?.claimWindow?.discard, privateState?.drawnTileId),
    [actions, game?.claimWindow?.discard, privateState?.drawnTileId, privateState?.hand]
  );

  useEffect(() => {
    setSelectedTileId(null);
  }, [game?.currentSeat, game?.phase, handSignature]);

  useEffect(() => {
    if (!settlementResult) {
      setDismissedSettlementHandId(null);
    }
  }, [settlementResult]);

  const renewGuestSession = useCallback(async (name?: string): Promise<GuestAuthResponse> => {
    const payload = await requestGuestSession(name);
    saveSession(payload);
    setSession(payload);
    setGuestName(payload.name);
    return payload;
  }, []);

  const handleAuthExpired = useCallback(
    (message = "登入已過期，請重新進入。") => {
      localStorage.removeItem(sessionStorageKey);
      setGuestName((current) => current || session?.name || "");
      setSession(null);
      setRoom(null);
      setGame(null);
      setPrivateState(null);
      setActions([]);
      setSettlement(null);
      setSocket((current) => {
        current?.disconnect();
        return null;
      });
      setError(message);
    },
    [session?.name]
  );

  const runWithFreshSession = useCallback(
    async <T,>(operation: (activeSession: GuestAuthResponse) => Promise<T>): Promise<T> => {
      if (!session) {
        throw new Error("尚未建立訪客身分。");
      }
      try {
        return await operation(session);
      } catch (caught) {
        if (!(caught instanceof AuthExpiredError)) {
          throw caught;
        }
        const renewed = await renewGuestSession(session.name);
        return operation(renewed);
      }
    },
    [renewGuestSession, session]
  );

  useEffect(() => {
    if (!session || !room) {
      socket?.disconnect();
      setSocket(null);
      return;
    }

    const nextSocket: MahjongSocket = io("/", {
      auth: {
        token: session.token,
        roomCode: room.code
      }
    });

    nextSocket.on("room.snapshot", (snapshot) => {
      setRoom(snapshot);
      setGame(snapshot.game ?? null);
      setSettlement(snapshot.game?.settlement ?? null);
    });
    nextSocket.on("game.publicState", (state) => {
      setGame(state);
      setSettlement(state.settlement ?? null);
    });
    nextSocket.on("game.privateState", setPrivateState);
    nextSocket.on("game.actionRequired", setActions);
    nextSocket.on("game.settlement", setSettlement);
    nextSocket.on("game.error", (payload) => setError(payload.message));
    nextSocket.on("connect_error", (socketError) => {
      if (socketError.message.toLowerCase().includes("auth")) {
        handleAuthExpired();
        return;
      }
      setError(socketError.message);
    });
    setSocket(nextSocket);

    return () => {
      nextSocket.disconnect();
    };
  }, [handleAuthExpired, room?.code, session?.token]);

  const authenticate = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await renewGuestSession(guestName || undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "建立訪客身分失敗。");
    } finally {
      setBusy(false);
    }
  }, [guestName, renewGuestSession]);

  const createRoom = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const snapshot = await runWithFreshSession((activeSession) =>
        api<RoomSnapshot>("/api/rooms", activeSession.token, {
          method: "POST",
          body: JSON.stringify({ mode: selectedMode })
        })
      );
      setRoom(snapshot);
      setJoinCode(snapshot.code);
    } catch (caught) {
      if (caught instanceof AuthExpiredError) {
        handleAuthExpired();
        return;
      }
      setError(caught instanceof Error ? caught.message : "建立房間失敗。");
    } finally {
      setBusy(false);
    }
  }, [handleAuthExpired, runWithFreshSession, selectedMode, session]);

  const joinRoom = useCallback(async () => {
    if (!session || !joinCode.trim()) return;
    setBusy(true);
    setError("");
    try {
      const roomCode = joinCode.trim().toUpperCase();
      const snapshot = await runWithFreshSession((activeSession) =>
        api<RoomSnapshot>(`/api/rooms/${roomCode}/join`, activeSession.token, {
          method: "POST"
        })
      );
      setRoom(snapshot);
    } catch (caught) {
      if (caught instanceof AuthExpiredError) {
        handleAuthExpired();
        return;
      }
      setError(caught instanceof Error ? caught.message : "加入房間失敗。");
    } finally {
      setBusy(false);
    }
  }, [handleAuthExpired, joinCode, runWithFreshSession, session]);

  const toggleReady = useCallback(() => {
    if (!socket || !mySeat) return;
    socket.emit("room.ready", { ready: !mySeat.ready });
  }, [mySeat, socket]);

  const leaveRoom = useCallback(() => {
    socket?.emit("room.leave");
    socket?.disconnect();
    setRoom(null);
    setGame(null);
    setPrivateState(null);
    setActions([]);
    setSettlement(null);
  }, [socket]);

  const addBot = useCallback(
    async (seatIndex: number) => {
      if (!session || !room) return;
      setError("");
      try {
        const roomCode = room.code;
        const snapshot = await runWithFreshSession((activeSession) =>
          api<RoomSnapshot>(`/api/rooms/${roomCode}/bots`, activeSession.token, {
            method: "POST",
            body: JSON.stringify({ seatIndex })
          })
        );
        setRoom(snapshot);
        setGame(snapshot.game ?? null);
        setSettlement(snapshot.game?.settlement ?? null);
      } catch (caught) {
        if (caught instanceof AuthExpiredError) {
          handleAuthExpired();
          return;
        }
        setError(caught instanceof Error ? caught.message : "加入電腦玩家失敗。");
      }
    },
    [handleAuthExpired, room, runWithFreshSession, session]
  );

  const clearSeat = useCallback(
    (seatIndex: number) => {
      if (!socket) return;
      socket.emit("room.clearSeat", { seatIndex });
    },
    [socket]
  );

  const discard = useCallback(
    (tile: Tile) => {
      if (!socket || !actions.some((action) => action.type === "discard" && action.tileId === tile.id)) {
        return;
      }
      if (selectedTileId !== tile.id) {
        setSelectedTileId(tile.id);
        return;
      }
      socket.emit("game.discard", { tileId: tile.id });
      setSelectedTileId(null);
    },
    [actions, selectedTileId, socket]
  );

  const triggerAction = useCallback(
    (action: LegalAction) => {
      if (!socket) return;
      if (action.type === "declareTing") {
        socket.emit("game.declareTing");
      } else if (action.type === "declareRiichi") {
        socket.emit("game.declareRiichi");
      } else if (action.type === "kong" && action.fromSeat === undefined) {
        socket.emit("game.kong", { tileIds: action.tileIds ?? [] });
      } else if (["win", "chow", "pong", "kong", "pass"].includes(action.type)) {
        const payload: { type: "win" | "chow" | "pong" | "kong" | "pass"; tileIds?: string[] } = {
          type: action.type as "win" | "chow" | "pong" | "kong" | "pass",
          ...(action.tileIds ? { tileIds: action.tileIds } : {})
        };
        socket.emit("game.claim", payload);
      }
    },
    [socket]
  );

  const copyCode = useCallback(async () => {
    if (!room) return;
    await navigator.clipboard.writeText(room.code);
  }, [room]);

  return (
    <main className={room ? "appShell gameAppShell" : "appShell lobbyAppShell"}>
      {error && (
        <div className="notice error">
          <WifiOff size={16} />
          <span>{error}</span>
          <button onClick={() => setError("")} title="關閉">
            <X size={16} />
          </button>
        </div>
      )}

      {!session && (
        <section className="entryPanel">
          <div className="entryHero">
            <span className="brandTile">雀</span>
            <div>
              <h1>台灣 16 張麻將</h1>
              <p>開房、補 AI、即時對局與結算。</p>
            </div>
          </div>
          <label>
            暱稱
            <input value={guestName} maxLength={20} onChange={(event) => setGuestName(event.target.value)} placeholder="輸入你的名字" />
          </label>
          <button className="primaryButton" disabled={busy} onClick={authenticate}>
            {busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            進入遊戲
          </button>
        </section>
      )}

      {session && !room && (
        <section className="entryPanel lobbyPanel">
          <div className="identity">
            <span>目前身分</span>
            <strong>{session.name}</strong>
          </div>
          <div className="modePicker" role="group" aria-label="選擇玩法">
            {(["taiwan", "riichi"] as const).map((mode) => (
              <button key={mode} className={selectedMode === mode ? "modeOption active" : "modeOption"} onClick={() => setSelectedMode(mode)}>
                {modeLabels[mode]}
              </button>
            ))}
          </div>
          <button className="primaryButton" disabled={busy} onClick={createRoom}>
            <Shuffle size={18} />
            建立 {modeLabels[selectedMode]} 房
          </button>
          <div className="joinBox">
            <input value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="輸入房號" />
            <button className="secondaryButton" disabled={busy || !joinCode.trim()} onClick={joinRoom}>
              <Send size={18} />
              加入
            </button>
          </div>
        </section>
      )}

      {session && room && (
        <section className="gameExperience">
          <header className="gameHeader">
            <div className="gameTitle">
              <span className="brandTile compact">雀</span>
              <div>
                <h1>{modeLabels[room.mode]} 麻將</h1>
                <p>
                  房號 <strong>{room.code}</strong>
                  {game ? ` · ${phaseLabel(game.phase)} · ${windFullLabels[game.roundWind]}` : " · 等待入桌"}
                </p>
              </div>
            </div>
            <div className="gameHeaderActions">
              <button className="iconButton" onClick={copyCode} title="複製房號">
                <Copy size={18} />
              </button>
              <button className="iconButton danger" onClick={leaveRoom} title="離開房間">
                <DoorOpen size={18} />
              </button>
            </div>
          </header>

          <div className="gameScene">
            <SeatManager
              room={room}
              game={game}
              myPlayerId={session.playerId}
              canManageSeats={canManageSeats}
              onAddBot={addBot}
              onClearSeat={clearSeat}
            />

            <div className="boardStack">
              <TableScreen room={room} game={game} privateState={privateState} mySeatIndex={mySeat?.seatIndex} myTurn={Boolean(myTurn)} />
              <ActionDock actions={visibleActions} tingTiles={privateState?.winningTiles ?? []} onAction={triggerAction} />
              <Hand
                tiles={privateState?.hand ?? []}
                discardableIds={discardableIds}
                selectedTileId={selectedTileId}
                drawnTileId={privateState?.drawnTileId}
                tingDiscardIds={tingDiscardIds}
                actionHintIds={actionHintIds}
                onTileClick={discard}
                myTurn={Boolean(myTurn)}
              />
            </div>

            <StatusPanel game={game} privateState={privateState} mySeatIndex={mySeat?.seatIndex} onReady={toggleReady} mySeatReady={mySeat?.ready} />
          </div>

          {showSettlement && settlementResult && (
            <SettlementOverlay
              result={settlementResult}
              game={game}
              privateState={privateState}
              mySeatReady={mySeat?.ready}
              onReady={toggleReady}
              onClose={() => setDismissedSettlementHandId(settlementResult.handId)}
            />
          )}
        </section>
      )}
    </main>
  );
}

function SeatManager({
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

function TableScreen({
  room,
  game,
  privateState,
  mySeatIndex,
  myTurn
}: {
  room: RoomSnapshot;
  game: GameState | null;
  privateState: PrivatePlayerState | null;
  mySeatIndex: number | undefined;
  myTurn: boolean;
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
    .map((player) => ({ player, distance: mySeatIndex === undefined ? player.seatIndex : (player.seatIndex - mySeatIndex + 4) % 4 }))
    .sort((left, right) => left.distance - right.distance);
  const selfPlayer = mySeatIndex === undefined ? undefined : game.players.find((player) => player.seatIndex === mySeatIndex);
  const currentPlayer = game.players.find((player) => player.seatIndex === game.currentSeat);
  const liveWallCount = Math.max(0, game.wallCount - game.deadWallCount);

  return (
    <div className={myTurn ? "gameBoard myTurn" : "gameBoard"}>
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
        <PlayerSpot
          key={player.seatIndex}
          player={player}
          distance={distance}
          active={game.currentSeat === player.seatIndex}
          isSelf={player.seatIndex === mySeatIndex}
        />
      ))}

      <div className="centerConsole">
        <div className="roundDial">
          <span>{modeLabels[game.mode]}</span>
          <strong>{windLabels[game.roundWind]}場</strong>
          <span>剩 {liveWallCount}</span>
          <span>{currentPlayer ? `${windLabels[currentPlayer.wind]}家` : "-"}</span>
        </div>
        <div className="centerPoints">
          <strong>{formatPoints(selfPlayer?.coins ?? 0)}</strong>
          <span>{phaseLabel(game.phase)}</span>
        </div>
        {game.lastDiscard && (
          <div className="lastDiscard">
            <MiniTile tile={game.lastDiscard.tile} />
            <span>{windLabels[game.players[game.lastDiscard.seatIndex]?.wind ?? "east"]}家打出</span>
          </div>
        )}
        {privateState?.winningTiles.length ? (
          <div className="waitPreview">
            {privateState.winningTiles.slice(0, 5).map((tile) => (
              <MiniTile key={tile.id} tile={tile} />
            ))}
          </div>
        ) : null}
      </div>
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
  const latestDiscards = player.discards.slice(-18);
  const meldTiles = player.melds.flatMap((meld) => meld.tiles.map((tile) => ({ tile, meldId: meld.id })));

  return (
    <div className={["playerSpot", `spot${distance}`, active ? "active" : "", isSelf ? "self" : ""].filter(Boolean).join(" ")}>
      <div className="playerBadge">
        <span className="avatar">{player.isBot ? <Bot size={18} /> : initials(player.name ?? windLabels[player.wind])}</span>
        <div>
          <strong>{player.name ?? `玩家 ${player.seatIndex + 1}`}</strong>
          <p>
            {windLabels[player.wind]}家 · {formatPoints(player.coins)}
          </p>
        </div>
        <span className="turnChip">{active ? "出牌" : player.declaredRiichi ? "立直" : player.declaredTing ? "聽" : `${player.handCount}張`}</span>
      </div>

      {!isSelf && (
        <div className={distance === 1 || distance === 3 ? "opponentWall vertical" : "opponentWall"}>
          <TileBacks count={Math.min(player.handCount, 18)} vertical={distance === 1 || distance === 3} />
        </div>
      )}

      {(meldTiles.length > 0 || player.flowerTiles.length > 0) && (
        <div className="spotMelds">
          {meldTiles.map(({ tile, meldId }) => (
            <MiniTile key={`${meldId}-${tile.id}`} tile={tile} />
          ))}
          {player.flowerTiles.map((tile) => (
            <MiniTile key={tile.id} tile={tile} flower />
          ))}
        </div>
      )}

      <div className="spotRiver">
        {latestDiscards.map((tile) => (
          <MiniTile key={tile.id} tile={tile} />
        ))}
      </div>
    </div>
  );
}

function StatusPanel({
  game,
  privateState,
  mySeatIndex,
  onReady,
  mySeatReady
}: {
  game: GameState | null;
  privateState: PrivatePlayerState | null;
  mySeatIndex: number | undefined;
  onReady: () => void;
  mySeatReady: boolean | undefined;
}) {
  const selfPlayer = mySeatIndex === undefined ? undefined : game?.players.find((player) => player.seatIndex === mySeatIndex);
  const canReady = !game || game.phase === "settled" || game.phase === "draw";

  return (
    <aside className="statusPanel" aria-label="牌況">
      <div className="infoPanel currentPanel">
        <div className="panelTitle">
          <Sparkles size={17} />
          <h2>牌況</h2>
        </div>
        <dl className="statGrid">
          <div>
            <dt>階段</dt>
            <dd>{game ? phaseLabel(game.phase) : "等候"}</dd>
          </div>
          <div>
            <dt>牌山</dt>
            <dd>{game?.wallCount ?? 0}</dd>
          </div>
          <div>
            <dt>圈風</dt>
            <dd>{game ? windFullLabels[game.roundWind] : "-"}</dd>
          </div>
          <div>
            <dt>自風</dt>
            <dd>{selfPlayer ? windFullLabels[selfPlayer.wind] : "-"}</dd>
          </div>
          <div>
            <dt>手牌</dt>
            <dd>{privateState?.hand.length ?? 0}</dd>
          </div>
          <div>
            <dt>點數</dt>
            <dd>{formatPoints(selfPlayer?.coins ?? 0)}</dd>
          </div>
        </dl>
        <button className={mySeatReady ? "readyButton ready" : "readyButton"} onClick={onReady} disabled={!canReady}>
          <Check size={18} />
          {mySeatReady ? "已準備" : game?.phase === "settled" || game?.phase === "draw" ? "下一局準備" : "準備"}
        </button>
      </div>

      <WinningTiles tiles={privateState?.winningTiles ?? []} hints={privateState?.tingHints ?? []} />
      <RiichiMeta game={game} />
    </aside>
  );
}

function RiichiMeta({ game }: { game: GameState | null }) {
  if (!game?.riichi) return null;
  return (
    <div className="infoPanel">
      <div className="panelTitle">
        <Crown size={17} />
        <h2>日麻資訊</h2>
      </div>
      <dl className="statGrid compact">
        <div>
          <dt>本場</dt>
          <dd>{game.riichi.honba}</dd>
        </div>
        <div>
          <dt>立直棒</dt>
          <dd>{game.riichi.riichiSticks}</dd>
        </div>
      </dl>
      <div className="doraStrip">
        <span>寶牌</span>
        {game.riichi.doraIndicators.map((tile) => (
          <MiniTile key={tile.id} tile={tile} />
        ))}
      </div>
    </div>
  );
}

function ActionDock({
  actions,
  tingTiles,
  onAction
}: {
  actions: LegalAction[];
  tingTiles: Tile[];
  onAction: (action: LegalAction) => void;
}) {
  const availableActions = actions.filter((action) => action.type !== "discard");
  if (availableActions.length === 0 && tingTiles.length === 0) return null;
  return (
    <div className="actionDock">
      {tingTiles.length > 0 && (
        <div className="tingPreview" title="可胡牌">
          <span>聽</span>
          {tingTiles.slice(0, 6).map((tile) => (
            <MiniTile key={tile.id} tile={tile} />
          ))}
        </div>
      )}
      {availableActions.map((action, index) => (
        <button
          key={`${action.type}-${action.tileId ?? ""}-${action.tileIds?.join("-") ?? ""}-${index}`}
          className={action.type === "win" ? "actionButton win" : action.type === "pass" ? "actionButton pass" : "actionButton"}
          onClick={() => onAction(action)}
          title={action.description ?? actionButtonLabel(action)}
        >
          {actionButtonLabel(action)}
        </button>
      ))}
    </div>
  );
}

function Hand({
  tiles,
  discardableIds,
  selectedTileId,
  drawnTileId,
  tingDiscardIds,
  actionHintIds,
  onTileClick,
  myTurn
}: {
  tiles: Tile[];
  discardableIds: Set<string>;
  selectedTileId: string | null;
  drawnTileId: string | undefined;
  tingDiscardIds: Set<string>;
  actionHintIds: Set<string>;
  onTileClick: (tile: Tile) => void;
  myTurn: boolean;
}) {
  return (
    <div className={myTurn ? "handDock myTurn" : "handDock"} aria-label="手牌">
      <div className="handStatus">{myTurn ? "輪到你" : "等待"}</div>
      <div className="handTiles">
        {tiles.map((tile) => (
          <TileButton
            key={tile.id}
            tile={tile}
            disabled={!discardableIds.has(tile.id)}
            highlighted={myTurn && discardableIds.has(tile.id)}
            selected={selectedTileId === tile.id}
            drawn={drawnTileId === tile.id}
            tingHint={tingDiscardIds.has(tile.id)}
            actionHint={actionHintIds.has(tile.id)}
            onClick={() => onTileClick(tile)}
          />
        ))}
      </div>
    </div>
  );
}

function WinningTiles({ tiles, hints }: { tiles: Tile[]; hints: PrivatePlayerState["tingHints"] }) {
  return (
    <div className="infoPanel">
      <div className="panelTitle">
        <Trophy size={17} />
        <h2>聽牌提示</h2>
      </div>
      {hints.length > 0 ? (
        <div className="tingHintList">
          {hints.map((hint) => (
            <div className="tingHintRow" key={hint.discardTile.id}>
              <span>打</span>
              <MiniTile tile={hint.discardTile} />
              <span>聽</span>
              <div className="miniTileRow">
                {hint.winningTiles.map((tile) => (
                  <MiniTile key={tile.id} tile={tile} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="miniTileRow relaxed">{tiles.length === 0 ? <span className="muted">尚無提示</span> : tiles.map((tile) => <MiniTile key={tile.id} tile={tile} />)}</div>
      )}
    </div>
  );
}

function SettlementOverlay({
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
  const displayTiles = isWinnerPerspective ? privateState.hand : [];
  const scoreRows = game?.players.map((player) => ({ player, delta: scoreDeltaForSeat(result, player.seatIndex) })) ?? [];

  return (
    <div className="settlementBackdrop" role="dialog" aria-modal="true" aria-label="結算">
      <section className="settlementScene">
        <div className="winnerShowcase">
          <span className="winnerAvatar">{isDraw ? "流" : initials(winner?.name ?? "和")}</span>
          <div>
            <span className="winnerLabel">{isDraw ? "荒牌流局" : winModeLabel(result.winMode)}</span>
            <h2>{isDraw ? result.drawReason ?? "流局" : winner?.name ?? `玩家 ${(result.winnerSeat ?? 0) + 1}`}</h2>
            <p>{isDraw ? "本局沒有玩家胡牌" : `${windFullLabels[winner?.wind ?? "east"]} · ${settlementLevel(result.baseTai)}`}</p>
          </div>
        </div>

        <div className="settlementBoard">
          <button className="closeSettlement" onClick={onClose} title="關閉結算">
            <X size={18} />
          </button>

          <div className="settlementTiles">
            {displayTiles.length > 0 ? (
              displayTiles.map((tile) => <TileButton key={tile.id} tile={tile} disabled />)
            ) : (
              <span>{isDraw ? `聽牌：${formatSeatList(result.tenpaiSeats)}` : "贏家手牌僅本人可見"}</span>
            )}
          </div>

          <div className="settlementStats">
            <div className="fanDial">
              <strong>{result.baseTai}</strong>
              <span>{game?.mode === "riichi" ? "番" : "台"}</span>
            </div>
            <div className="patternList">
              {result.patterns.length === 0 ? (
                <span className="patternPill">無役種變動</span>
              ) : (
                result.patterns.map((pattern) => (
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
            <span>{isDraw ? "NO GAME" : settlementLevel(result.baseTai)}</span>
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

function TileBacks({ count, vertical }: { count: number; vertical?: boolean }) {
  return (
    <div className={vertical ? "tileBacks vertical" : "tileBacks"} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function TileButton({
  tile,
  disabled,
  highlighted,
  selected,
  drawn,
  tingHint,
  actionHint,
  onClick
}: {
  tile: Tile;
  disabled?: boolean;
  highlighted?: boolean;
  selected?: boolean;
  drawn?: boolean;
  tingHint?: boolean;
  actionHint?: boolean;
  onClick?: () => void;
}) {
  const imagePath = tileImagePath(tile);
  const className = [
    "tileButton",
    highlighted ? "highlighted" : "",
    selected ? "selected" : "",
    drawn ? "drawn" : "",
    tingHint ? "tingHint" : "",
    actionHint ? "actionHint" : "",
    tile.red ? "redFive" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={className} disabled={disabled} onClick={onClick} title={tile.label} aria-label={tile.label}>
      {imagePath ? <img className="tileImage" src={imagePath} alt="" draggable={false} /> : <span className="tileFallback">{tile.label}</span>}
    </button>
  );
}

function MiniTile({ tile, flower }: { tile: Tile; flower?: boolean }) {
  const imagePath = tileImagePath(tile);
  const className = ["miniTile", flower ? "flower" : "", tile.red ? "redFive" : ""].filter(Boolean).join(" ");

  return (
    <span className={className} title={tile.label} aria-label={tile.label}>
      {imagePath ? <img className="tileImage" src={imagePath} alt="" draggable={false} /> : <span className="tileFallback">{tile.label}</span>}
    </span>
  );
}

async function api<T>(path: string, token: string, init: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...headers
    }
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const message = errorMessage(payload, "Request failed.");
    if (response.status === 401) {
      throw new AuthExpiredError(message);
    }
    throw new Error(message);
  }
  return payload as T;
}

async function requestGuestSession(name: string | undefined): Promise<GuestAuthResponse> {
  const response = await fetch("/api/auth/guest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name || undefined })
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(payload, "建立訪客身分失敗。"));
  }
  return payload as GuestAuthResponse;
}

function saveSession(session: GuestAuthResponse): void {
  localStorage.setItem(sessionStorageKey, JSON.stringify(session));
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
    return payload.message;
  }
  return fallback;
}

function readSession(): GuestAuthResponse | null {
  const raw = localStorage.getItem(sessionStorageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GuestAuthResponse;
  } catch {
    localStorage.removeItem(sessionStorageKey);
    return null;
  }
}

function phaseLabel(phase: GameState["phase"]): string {
  const labels: Record<GameState["phase"], string> = {
    waiting: "等待",
    playing: "對局中",
    claiming: "鳴牌回應",
    settled: "結算",
    draw: "流局"
  };
  return labels[phase];
}

function actionLabel(action: LegalAction): string {
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

function actionButtonLabel(action: LegalAction): string {
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

function formatSeatList(seats: number[] | undefined): string {
  if (!seats || seats.length === 0) {
    return "無";
  }
  return seats.map((seat) => `${seat + 1}家`).join("、");
}

function buildActionHintIds(actions: LegalAction[], hand: Tile[], claimDiscard: Tile | undefined, drawnTileId: string | undefined): Set<string> {
  const ids = new Set<string>();

  for (const action of actions) {
    if ((action.type === "chow" || action.type === "kong") && action.tileIds) {
      for (const tileId of action.tileIds) {
        ids.add(tileId);
      }
    }

    if ((action.type === "chow" || action.type === "pong" || action.type === "kong") && !action.tileIds && claimDiscard) {
      for (const tile of hand) {
        if (isSameTileFace(tile, claimDiscard)) {
          ids.add(tile.id);
        }
      }
    }

    if (action.type === "win" && drawnTileId) {
      ids.add(drawnTileId);
    }
  }

  return ids;
}

function isSameTileFace(left: Tile, right: Tile): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "suited" && right.kind === "suited") {
    return left.suit === right.suit && left.rank === right.rank;
  }
  if (left.wind || right.wind) {
    return left.wind === right.wind;
  }
  if (left.dragon || right.dragon) {
    return left.dragon === right.dragon;
  }
  return left.flower === right.flower;
}

function seatStatusLabel(
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

function initials(name: string): string {
  return Array.from(name.trim())[0] ?? "雀";
}

function formatPoints(value: number): string {
  return new Intl.NumberFormat("zh-TW").format(Math.round(value));
}

function winModeLabel(mode: ScoringResult["winMode"]): string {
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

function settlementLevel(tai: number): string {
  if (tai >= 13) return "役滿";
  if (tai >= 8) return "倍滿";
  if (tai >= 6) return "跳滿";
  if (tai >= 4) return "滿貫";
  return `${tai} 台`;
}

function scoreDeltaForSeat(result: ScoringResult, seatIndex: number): number {
  return result.payments.reduce((total, payment) => {
    if (payment.toSeat === seatIndex) return total + payment.amount;
    if (payment.fromSeat === seatIndex) return total - payment.amount;
    return total;
  }, 0);
}
