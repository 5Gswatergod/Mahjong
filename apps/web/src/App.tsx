import { Check, Copy, DoorOpen, Loader2, Play, RefreshCw, Send, Shuffle, Trophy, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  type ClientToServerEvents,
  type GameState,
  type GuestAuthResponse,
  type LegalAction,
  type PrivatePlayerState,
  type RoomSnapshot,
  type ScoringResult,
  type ServerToClientEvents,
  type Tile,
  windLabels
} from "@taiwan-mahjong/shared";
import { tileImagePath } from "./tileAssets";

type MahjongSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const sessionStorageKey = "mahjong.guestSession";

export function App() {
  const [session, setSession] = useState<GuestAuthResponse | null>(() => readSession());
  const [guestName, setGuestName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [privateState, setPrivateState] = useState<PrivatePlayerState | null>(null);
  const [actions, setActions] = useState<LegalAction[]>([]);
  const [settlement, setSettlement] = useState<ScoringResult | null>(null);
  const [socket, setSocket] = useState<MahjongSocket | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const mySeat = useMemo(() => {
    if (!room || !session) return undefined;
    return room.seats.find((seat) => seat.playerId === session.playerId);
  }, [room, session]);

  const myTurn = game?.phase === "playing" && game.currentSeat === mySeat?.seatIndex;
  const claimActions = actions.filter((action) => ["win", "chow", "pong", "kong", "pass"].includes(action.type));
  const commandActions = actions.filter((action) => ["win", "kong", "declareTing"].includes(action.type));

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
    nextSocket.on("connect_error", (socketError) => setError(socketError.message));
    setSocket(nextSocket);

    return () => {
      nextSocket.disconnect();
    };
  }, [room?.code, session?.token]);

  const authenticate = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: guestName || undefined })
      });
      const payload = (await response.json()) as GuestAuthResponse;
      if (!response.ok) throw new Error("建立訪客失敗");
      localStorage.setItem(sessionStorageKey, JSON.stringify(payload));
      setSession(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "建立訪客失敗");
    } finally {
      setBusy(false);
    }
  }, [guestName]);

  const createRoom = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const snapshot = await api<RoomSnapshot>("/api/rooms", session.token, { method: "POST" });
      setRoom(snapshot);
      setJoinCode(snapshot.code);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "建立房間失敗");
    } finally {
      setBusy(false);
    }
  }, [session]);

  const joinRoom = useCallback(async () => {
    if (!session || !joinCode.trim()) return;
    setBusy(true);
    setError("");
    try {
      const snapshot = await api<RoomSnapshot>(`/api/rooms/${joinCode.trim().toUpperCase()}/join`, session.token, {
        method: "POST"
      });
      setRoom(snapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加入房間失敗");
    } finally {
      setBusy(false);
    }
  }, [joinCode, session]);

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

  const discard = useCallback(
    (tile: Tile) => {
      if (!socket || !actions.some((action) => action.type === "discard" && action.tileId === tile.id)) {
        return;
      }
      socket.emit("game.discard", { tileId: tile.id });
    },
    [actions, socket]
  );

  const triggerAction = useCallback(
    (action: LegalAction) => {
      if (!socket) return;
      if (action.type === "declareTing") {
        socket.emit("game.declareTing");
      } else if (action.type === "kong") {
        socket.emit("game.kong", { tileIds: action.tileIds ?? [] });
      } else if (["win", "chow", "pong", "pass"].includes(action.type)) {
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
          <button className="primaryButton" disabled={busy} onClick={createRoom}>
            <Shuffle size={18} />
            建立四人房
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
            <SeatList room={room} myPlayerId={session.playerId} />
            <button className={mySeat?.ready ? "readyButton ready" : "readyButton"} onClick={toggleReady}>
              <Check size={18} />
              {mySeat?.ready ? "已準備" : game?.phase === "settled" || game?.phase === "draw" ? "下一局準備" : "準備"}
            </button>
            <GameMeta game={game} privateState={privateState} />
          </aside>

          <section className="tableSurface">
            <Table game={game} mySeatIndex={mySeat?.seatIndex} />
            <ActionDock actions={claimActions.length > 0 ? claimActions : commandActions} onAction={triggerAction} />
            <Hand
              tiles={privateState?.hand ?? []}
              discardableIds={new Set(actions.filter((action) => action.type === "discard").map((action) => action.tileId).filter(Boolean) as string[])}
              onTileClick={discard}
              myTurn={Boolean(myTurn)}
            />
          </section>

          <aside className="sidePanel">
            <WinningTiles tiles={privateState?.winningTiles ?? []} />
            <Settlement result={settlement ?? game?.settlement} />
          </aside>
        </section>
      )}
    </main>
  );
}

function SeatList({ room, myPlayerId }: { room: RoomSnapshot; myPlayerId: string }) {
  return (
    <div className="panelBlock">
      <h2>座位</h2>
      <div className="seatList">
        {room.seats.map((seat) => (
          <div className="seatRow" key={seat.seatIndex}>
            <span className="windBadge">{windLabels[seat.wind]}</span>
            <div>
              <strong>{seat.name ?? "等待玩家"}</strong>
              <p>{seat.playerId === myPlayerId ? "你" : seat.connected ? "在線" : seat.playerId ? "離線" : "空位"}</p>
            </div>
            <span className={seat.ready ? "statePill ready" : "statePill"}>{seat.ready ? "Ready" : `${seat.coins}`}</span>
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

  return (
    <div className="mahjongTable">
      {orderedSeats.map(({ player, distance }) => (
        <div className={`tableSeat seatPosition${distance}`} key={player.seatIndex}>
          <div className={game.currentSeat === player.seatIndex ? "playerPlate active" : "playerPlate"}>
            <span>{windLabels[player.wind]}</span>
            <strong>{player.name ?? `玩家 ${player.seatIndex + 1}`}</strong>
            <small>{player.handCount} 張</small>
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
        <span>{phaseLabel(game.phase)}</span>
        {game.lastDiscard && <TileButton tile={game.lastDiscard.tile} disabled />}
      </div>
    </div>
  );
}

function ActionDock({ actions, onAction }: { actions: LegalAction[]; onAction: (action: LegalAction) => void }) {
  if (actions.length === 0) return null;
  return (
    <div className="actionDock">
      {actions.map((action, index) => (
        <button key={`${action.type}-${action.tileId ?? ""}-${index}`} className={action.type === "win" ? "winButton" : "secondaryButton"} onClick={() => onAction(action)}>
          {actionLabel(action)}
        </button>
      ))}
    </div>
  );
}

function Hand({
  tiles,
  discardableIds,
  onTileClick,
  myTurn
}: {
  tiles: Tile[];
  discardableIds: Set<string>;
  onTileClick: (tile: Tile) => void;
  myTurn: boolean;
}) {
  return (
    <div className="handDock" aria-label="手牌">
      {tiles.map((tile) => (
        <TileButton key={tile.id} tile={tile} disabled={!discardableIds.has(tile.id)} highlighted={myTurn && discardableIds.has(tile.id)} onClick={() => onTileClick(tile)} />
      ))}
    </div>
  );
}

function WinningTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="panelBlock">
      <h2>聽牌</h2>
      <div className="miniTileRow">
        {tiles.length === 0 ? <span className="muted">目前未聽</span> : tiles.map((tile) => <MiniTile key={tile.id} tile={tile} />)}
      </div>
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
  return (
    <div className="panelBlock settlement">
      <h2>
        <Trophy size={18} />
        結算
      </h2>
      <strong>玩家 {result.winnerSeat + 1} 胡牌，共 {result.baseTai} 台</strong>
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

function TileButton({ tile, disabled, highlighted, onClick }: { tile: Tile; disabled?: boolean; highlighted?: boolean; onClick?: () => void }) {
  const imagePath = tileImagePath(tile);

  return (
    <button className={highlighted ? "tileButton highlighted" : "tileButton"} disabled={disabled} onClick={onClick} title={tile.label} aria-label={tile.label}>
      {imagePath ? <img className="tileImage" src={imagePath} alt="" draggable={false} /> : <span className="tileFallback">{tile.label}</span>}
    </button>
  );
}

function MiniTile({ tile, flower }: { tile: Tile; flower?: boolean }) {
  const imagePath = tileImagePath(tile);

  return (
    <span className={flower ? "miniTile flower" : "miniTile"} title={tile.label} aria-label={tile.label}>
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
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? "Request failed.");
  }
  return payload as T;
}

function readSession(): GuestAuthResponse | null {
  const raw = localStorage.getItem(sessionStorageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GuestAuthResponse;
  } catch {
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
    declareTing: "聽"
  };
  return labels[action.type];
}
