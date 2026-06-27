import { Check, Copy, DoorOpen, Loader2, Play, RefreshCw, Send, Shuffle, Trophy, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  type ClientToServerEvents,
  type GameMode,
  type GameState,
  type GuestAuthResponse,
  type LegalAction,
  type PrivatePlayerState,
  type RoomSnapshot,
  type ScoringResult,
  type ServerToClientEvents,
  type Tile,
  gameModeLabels,
  windLabels
} from "@taiwan-mahjong/shared";
import { tileImagePath } from "./tileAssets";

type MahjongSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const sessionStorageKey = "mahjong.guestSession";

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

  const mySeat = useMemo(() => {
    if (!room || !session) return undefined;
    return room.seats.find((seat) => seat.playerId === session.playerId);
  }, [room, session]);

  const myTurn = game?.phase === "playing" && game.currentSeat === mySeat?.seatIndex;
  const claimActions = actions.filter((action) => ["win", "chow", "pong", "kong", "pass"].includes(action.type));
  const commandActions = actions.filter((action) => ["win", "kong", "declareRiichi"].includes(action.type));
  const visibleActions = claimActions.length > 0 ? claimActions : commandActions;
  const handSignature = privateState?.hand.map((tile) => tile.id).join("|") ?? "";
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

  const renewGuestSession = useCallback(async (name?: string): Promise<GuestAuthResponse> => {
    const payload = await requestGuestSession(name);
    saveSession(payload);
    setSession(payload);
    setGuestName(payload.name);
    return payload;
  }, []);

  const handleAuthExpired = useCallback(
    (message = "訪客登入已失效，已清除舊資料，請重新進入遊戲。") => {
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
    });
    nextSocket.on("game.publicState", (state) => {
      setGame(state);
      if (state.settlement) setSettlement(state.settlement);
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
      setError(caught instanceof Error ? caught.message : "建立訪客失敗");
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
      setError(caught instanceof Error ? caught.message : "建立房間失敗");
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
      setError(caught instanceof Error ? caught.message : "加入房間失敗");
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
      } catch (caught) {
        if (caught instanceof AuthExpiredError) {
          handleAuthExpired();
          return;
        }
        setError(caught instanceof Error ? caught.message : "加入電腦失敗");
      }
    },
    [handleAuthExpired, room, runWithFreshSession, session]
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
    <main className="appShell">
      <section className="topBar">
        <div>
          <h1>台灣 16 張麻將</h1>
          <p>{room ? `房號 ${room.code}` : "四人房 MVP"}</p>
        </div>
        <div className="topActions">
          {room && (
            <button className="iconButton" onClick={copyCode} title="複製房號">
              <Copy size={18} />
            </button>
          )}
          {room && (
            <button className="iconButton" onClick={leaveRoom} title="離開房間">
              <DoorOpen size={18} />
            </button>
          )}
        </div>
      </section>

      {error && (
        <div className="notice error">
          <WifiOff size={16} />
          <span>{error}</span>
          <button onClick={() => setError("")}>關閉</button>
        </div>
      )}

      {!session && (
        <section className="authPanel">
          <label>
            暱稱
            <input value={guestName} maxLength={20} onChange={(event) => setGuestName(event.target.value)} placeholder="輸入牌桌暱稱" />
          </label>
          <button className="primaryButton" disabled={busy} onClick={authenticate}>
            {busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            進入遊戲
          </button>
        </section>
      )}

      {session && !room && (
        <section className="lobbyPanel">
          <div className="identity">
            <span>玩家</span>
            <strong>{session.name}</strong>
          </div>
          <div className="modePicker" role="group" aria-label="遊戲模式">
            {(["taiwan", "riichi"] as const).map((mode) => (
              <button key={mode} className={selectedMode === mode ? "modeOption active" : "modeOption"} onClick={() => setSelectedMode(mode)}>
                {gameModeLabels[mode]}
              </button>
            ))}
          </div>
          <button className="primaryButton" disabled={busy} onClick={createRoom}>
            <Shuffle size={18} />
            建立{gameModeLabels[selectedMode]}房
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
        <section className="gameLayout">
          <aside className="sidePanel">
            <SeatList
              room={room}
              myPlayerId={session.playerId}
              canAddBot={room.hostPlayerId === session.playerId && (!game || game.phase === "settled" || game.phase === "draw")}
              onAddBot={addBot}
            />
            <button className={mySeat?.ready ? "readyButton ready" : "readyButton"} onClick={toggleReady}>
              <Check size={18} />
              {mySeat?.ready ? "已準備" : game?.phase === "settled" || game?.phase === "draw" ? "下一局準備" : "準備"}
            </button>
            <GameMeta game={game} privateState={privateState} />
            <RiichiMeta game={game} />
          </aside>

          <section className="tableSurface">
            <Table game={game} mySeatIndex={mySeat?.seatIndex} />
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
          </section>

          <aside className="sidePanel">
            <WinningTiles tiles={privateState?.winningTiles ?? []} hints={privateState?.tingHints ?? []} />
            <Settlement result={settlement ?? game?.settlement} />
          </aside>
        </section>
      )}
    </main>
  );
}

function SeatList({
  room,
  myPlayerId,
  canAddBot,
  onAddBot
}: {
  room: RoomSnapshot;
  myPlayerId: string;
  canAddBot: boolean;
  onAddBot: (seatIndex: number) => void;
}) {
  return (
    <div className="panelBlock">
      <h2>座位 · {gameModeLabels[room.mode]}</h2>
      <div className="seatList">
        {room.seats.map((seat) => (
          <div className="seatRow" key={seat.seatIndex}>
            <span className="windBadge">{windLabels[seat.wind]}</span>
            <div>
              <strong>{seat.name ?? "等待玩家"}</strong>
              <p>{seat.isBot ? "電腦玩家" : seat.playerId === myPlayerId ? "你" : seat.connected ? "在線" : seat.playerId ? "離線" : "空位"}</p>
            </div>
            {canAddBot && !seat.playerId ? (
              <button className="botButton" onClick={() => onAddBot(seat.seatIndex)}>AI</button>
            ) : (
              <span className={seat.ready || seat.isBot ? "statePill ready" : "statePill"}>{seat.isBot ? "AI" : seat.ready ? "Ready" : `${seat.coins}`}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GameMeta({ game, privateState }: { game: GameState | null; privateState: PrivatePlayerState | null }) {
  return (
    <div className="panelBlock compactStats">
      <h2>牌局</h2>
      <dl>
        <div>
          <dt>狀態</dt>
          <dd>{game ? phaseLabel(game.phase) : "等待開局"}</dd>
        </div>
        <div>
          <dt>牌牆</dt>
          <dd>{game?.wallCount ?? 0}</dd>
        </div>
        <div>
          <dt>模式</dt>
          <dd>{game ? gameModeLabels[game.mode] : "-"}</dd>
        </div>
        <div>
          <dt>圈風</dt>
          <dd>{game ? windLabels[game.roundWind] : "-"}</dd>
        </div>
        <div>
          <dt>手牌</dt>
          <dd>{privateState?.hand.length ?? 0}</dd>
        </div>
      </dl>
    </div>
  );
}

function RiichiMeta({ game }: { game: GameState | null }) {
  if (!game?.riichi) return null;
  return (
    <div className="panelBlock riichiStats">
      <h2>日麻資訊</h2>
      <dl>
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

function Table({ game, mySeatIndex }: { game: GameState | null; mySeatIndex: number | undefined }) {
  if (!game) {
    return (
      <div className="tableEmpty">
        <RefreshCw size={28} />
        <span>等四位玩家準備後開局</span>
      </div>
    );
  }

  const orderedSeats = game.players
    .map((player) => ({ player, distance: mySeatIndex === undefined ? player.seatIndex : (player.seatIndex - mySeatIndex + 4) % 4 }))
    .sort((left, right) => left.distance - right.distance);
  const selfPlayer = mySeatIndex === undefined ? undefined : game.players.find((player) => player.seatIndex === mySeatIndex);
  const liveWallCount = Math.max(0, game.wallCount - game.deadWallCount);

  return (
    <div className="mahjongTable">
      {orderedSeats.map(({ player, distance }) => (
        <div className={`tableSeat seatPosition${distance}`} key={player.seatIndex}>
          <div className={game.currentSeat === player.seatIndex ? "playerPlate active" : "playerPlate"}>
            <span>{windLabels[player.wind]}</span>
            <strong>{player.name ?? `玩家 ${player.seatIndex + 1}`}</strong>
            <small>{player.declaredRiichi ? "立直" : `${player.handCount} 張`}</small>
          </div>
          <div className="meldStrip">
            {player.melds.flatMap((meld) => meld.tiles.map((tile) => <MiniTile key={`${meld.id}-${tile.id}`} tile={tile} />))}
            {player.flowerTiles.map((tile) => (
              <MiniTile key={tile.id} tile={tile} flower />
            ))}
          </div>
          <div className="discardRiver">
            {player.discards.slice(-10).map((tile) => (
              <MiniTile key={tile.id} tile={tile} />
            ))}
          </div>
        </div>
      ))}
      <div className="tableCenter">
        <div className="tableInfo">
          <span>{phaseLabel(game.phase)}</span>
          <span>剩 {liveWallCount} 張流局</span>
          <span>圈風 {windLabels[game.roundWind]}</span>
          {selfPlayer && <span>風位 {windLabels[selfPlayer.wind]}</span>}
        </div>
        {game.lastDiscard && <TileButton tile={game.lastDiscard.tile} disabled />}
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
  const availableActions = actions.filter((action) => action.type !== "discard" && action.type !== "declareTing");
  if (availableActions.length === 0 && tingTiles.length === 0) return null;
  return (
    <div className="actionDock">
      {tingTiles.length > 0 && (
        <button className="tingButton" type="button" title="聽牌提示">
          聽
        </button>
      )}
      {availableActions.map((action, index) => (
        <button
          key={`${action.type}-${action.tileId ?? ""}-${action.tileIds?.join("-") ?? ""}-${index}`}
          className={action.type === "win" ? "winButton" : "secondaryButton"}
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
    <div className="handDock" aria-label="手牌">
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
  );
}

function WinningTiles({ tiles, hints }: { tiles: Tile[]; hints: PrivatePlayerState["tingHints"] }) {
  return (
    <div className="panelBlock">
      <h2>聽牌提示</h2>
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
        <div className="miniTileRow">
          {tiles.length === 0 ? <span className="muted">目前未聽</span> : tiles.map((tile) => <MiniTile key={tile.id} tile={tile} />)}
        </div>
      )}
    </div>
  );
}

function Settlement({ result }: { result: ScoringResult | undefined }) {
  if (!result) {
    return (
      <div className="panelBlock">
        <h2>結算</h2>
        <p className="muted">胡牌後會顯示台數與娛樂幣變化。</p>
      </div>
    );
  }
  if (result.winMode === "draw") {
    return (
      <div className="panelBlock settlement">
        <h2>
          <Trophy size={18} />
          結算
        </h2>
        <strong>{result.drawReason ?? "流局"}</strong>
        <div className="patterns">
          <span>聽牌 {formatSeatList(result.tenpaiSeats)}</span>
          <span>不聽 {formatSeatList(result.notenSeats)}</span>
        </div>
        <div className="payments">
          {result.payments.length === 0 ? (
            <p>本局無不聽罰符轉移。</p>
          ) : (
            result.payments.map((payment, index) => (
              <p key={`${payment.fromSeat}-${payment.toSeat}-${index}`}>
                玩家 {payment.fromSeat + 1} → 玩家 {payment.toSeat + 1}: {payment.amount}
              </p>
            ))
          )}
        </div>
      </div>
    );
  }

  const winnerSeat = result.winnerSeat ?? 0;
  return (
    <div className="panelBlock settlement">
      <h2>
        <Trophy size={18} />
        結算
      </h2>
      <strong>玩家 {winnerSeat + 1} 胡牌，共 {result.baseTai} 台</strong>
      <div className="patterns">
        {result.patterns.map((pattern) => (
          <span key={pattern.id}>{pattern.name} +{pattern.tai}</span>
        ))}
      </div>
      <div className="payments">
        {result.payments.map((payment) => (
          <p key={`${payment.fromSeat}-${payment.toSeat}`}>
            玩家 {payment.fromSeat + 1} → 玩家 {payment.toSeat + 1}: {payment.amount}
          </p>
        ))}
      </div>
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
    throw new Error(errorMessage(payload, "建立訪客失敗"));
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
    playing: "進行中",
    claiming: "回應中",
    settled: "已結算",
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
  return actionLabel({ type: action.type });
}

function formatSeatList(seats: number[] | undefined): string {
  if (!seats || seats.length === 0) {
    return "無";
  }
  return seats.map((seat) => `玩家 ${seat + 1}`).join("、");
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
