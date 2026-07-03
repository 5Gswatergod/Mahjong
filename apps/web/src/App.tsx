import { BookOpen, Copy, DoorOpen, Loader2, Pencil, Play, Save, Send, Shuffle, WifiOff, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  type ClientToServerEvents,
  type GameConfig,
  type GameMode,
  type GameState,
  type GuestAuthResponse,
  type LegalAction,
  type PrivatePlayerState,
  type RoomSnapshot,
  type ScoringResult,
  type ServerToClientEvents,
  type Tile
} from "@taiwan-mahjong/shared";
import { ActionDock } from "./components/ActionDock";
import { Hand } from "./components/Hand";
import { PatternCatalog } from "./components/PatternCatalog";
import { AudioSettings, AudioSettingsButton, MusicDirector, readStoredMusicVolume } from "./components/GameAudio";
import { RoomLobby } from "./components/RoomLobby";
import { defaultRoomConfig, RoomSettingsPanel } from "./components/RoomSettingsPanel";
import { SettlementOverlay } from "./components/SettlementOverlay";
import { TableScreen } from "./components/TableScreen";
import { AuthExpiredError, api, clearSession, readSession, requestGuestSession, saveSession, updateGuestSessionName } from "./api";
import { modeLabels, windFullLabels } from "./constants";
import {
  drawMusicTracks,
  lobbyMusicTracks,
  mainMenuMusicTracks,
  musicTracks,
  selfDrawMusicTracks,
  tableMusicTracks,
  tenpaiMusicTracks,
  winMusicTracks
} from "./musicAssets";
import { buildActionHintIds } from "./utils/actions";
import { phaseLabel } from "./utils/labels";

type MahjongSocket = Socket<ServerToClientEvents, ClientToServerEvents>;


export function App() {
  const [session, setSession] = useState<GuestAuthResponse | null>(() => readSession());
  const [guestName, setGuestName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [selectedMode, setSelectedMode] = useState<GameMode>("taiwan");
  const [roomConfig, setRoomConfig] = useState<GameConfig>(() => defaultRoomConfig("taiwan"));
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [privateState, setPrivateState] = useState<PrivatePlayerState | null>(null);
  const [actions, setActions] = useState<LegalAction[]>([]);
  const [settlement, setSettlement] = useState<ScoringResult | null>(null);
  const [socket, setSocket] = useState<MahjongSocket | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [renamingName, setRenamingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [dismissedSettlementHandId, setDismissedSettlementHandId] = useState<string | null>(null);
  const [showPatternCatalog, setShowPatternCatalog] = useState(false);
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [musicVolume, setMusicVolume] = useState(readStoredMusicVolume);

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
  const serverNow = clockMs + clockOffsetMs;
  const activeGame = Boolean(game && game.phase !== "waiting" && game.phase !== "settled" && game.phase !== "draw");
  const selfPlayer = mySeat ? game?.players.find((player) => player.seatIndex === mySeat.seatIndex) : undefined;
  const showHandTingHint = Boolean(selfPlayer?.declaredTing || selfPlayer?.declaredRiichi);
  const hasTingPlayer = Boolean(game?.players.some((player) => player.declaredTing || player.declaredRiichi));
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
  const actionHintIds = useMemo(
    () => buildActionHintIds(actions, privateState?.hand ?? [], game?.claimWindow?.discard, privateState?.drawnTileId),
    [actions, game?.claimWindow?.discard, privateState?.drawnTileId, privateState?.hand]
  );
  const activeMusicTrack = useMemo(() => {
    const trackSeed = game?.handId ?? room?.code ?? "music";
    const tableTrack = tableMusicTracks[stableIndex(trackSeed, tableMusicTracks.length)] ?? musicTracks.tableOne;
    const tenpaiTrack = tenpaiMusicTracks[stableIndex(trackSeed, tenpaiMusicTracks.length)] ?? musicTracks.tenpaiOne;
    const drawTrack = drawMusicTracks[stableIndex(trackSeed, drawMusicTracks.length)] ?? musicTracks.drawOne;
    const winTrack = winMusicTracks[stableIndex(trackSeed, winMusicTracks.length)] ?? musicTracks.winOne;
    const selfDrawTrack = selfDrawMusicTracks[stableIndex(trackSeed, selfDrawMusicTracks.length)] ?? musicTracks.selfDrawOne;
    const mainMenuTrack = mainMenuMusicTracks[stableIndex("main-menu", mainMenuMusicTracks.length)] ?? musicTracks.mainMenuOne;
    const lobbyTrack = lobbyMusicTracks[stableIndex(room?.code ?? "lobby", lobbyMusicTracks.length)] ?? musicTracks.lobbyOne;

    if (showSettlement && settlementResult) {
      if (settlementResult.winMode === "draw") {
        return drawTrack;
      }
      if (settlementResult.winMode === "selfDraw" || settlementResult.winMode === "eightFlowers") {
        return selfDrawTrack;
      }
      return winTrack;
    }

    if (activeGame) {
      if (hasTingPlayer) {
        return tenpaiTrack;
      }
      return tableTrack;
    }

    if (room) {
      return lobbyTrack;
    }

    return mainMenuTrack;
  }, [activeGame, game?.handId, hasTingPlayer, room, settlementResult, showSettlement]);

  useEffect(() => {
    setSelectedTileId(null);
  }, [game?.currentSeat, game?.phase, handSignature]);

  useEffect(() => {
    if (!settlementResult) {
      setDismissedSettlementHandId(null);
    }
  }, [settlementResult]);

  useEffect(() => {
    setRoomConfig(defaultRoomConfig(selectedMode));
  }, [selectedMode]);

  useEffect(() => {
    if (session && !renamingName) {
      setProfileNameDraft(session.name);
    }
  }, [renamingName, session]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const applyServerTime = useCallback((serverTime: number | undefined) => {
    if (typeof serverTime !== "number") return;
    const nextOffset = serverTime - Date.now();
    setClockOffsetMs((current) => Math.round(current === 0 ? nextOffset : current * 0.75 + nextOffset * 0.25));
  }, []);

  const syncServerClock = useCallback(async () => {
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/time", { cache: "no-store" });
      const payload = (await response.json()) as { serverTime?: unknown };
      const endedAt = Date.now();
      if (typeof payload.serverTime !== "number") return;
      setLatencyMs(endedAt - startedAt);
      const estimatedServerNow = payload.serverTime;
      const estimatedClientNowAtServerSend = startedAt + (endedAt - startedAt) / 2;
      const nextOffset = estimatedServerNow - estimatedClientNowAtServerSend;
      setClockOffsetMs((current) => Math.round(current === 0 ? nextOffset : current * 0.6 + nextOffset * 0.4));
    } catch {
      setLatencyMs(null);
    }
  }, []);

  useEffect(() => {
    void syncServerClock();
    const timer = window.setInterval(() => void syncServerClock(), 10_000);
    return () => window.clearInterval(timer);
  }, [syncServerClock]);

  const renewGuestSession = useCallback(async (name?: string): Promise<GuestAuthResponse> => {
    const payload = await requestGuestSession(name);
    saveSession(payload);
    setSession(payload);
    setGuestName(payload.name);
    return payload;
  }, []);

  const handleAuthExpired = useCallback(
    (message = "登入已過期，請重新進入。") => {
      clearSession();
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
      applyServerTime(snapshot.serverTime);
      setRoom(snapshot);
      setGame(snapshot.game ?? null);
      setSettlement(snapshot.game?.settlement ?? null);
    });
    nextSocket.on("game.publicState", (state) => {
      applyServerTime(state.serverTime);
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
  }, [applyServerTime, handleAuthExpired, room?.code, session?.token]);

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
          body: JSON.stringify({ mode: selectedMode, config: roomConfig })
        })
      );
      applyServerTime(snapshot.serverTime);
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
  }, [applyServerTime, handleAuthExpired, roomConfig, runWithFreshSession, selectedMode, session]);

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
      applyServerTime(snapshot.serverTime);
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
  }, [applyServerTime, handleAuthExpired, joinCode, runWithFreshSession, session]);

  const saveProfileName = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (!session || savingName) return;

      const nextName = profileNameDraft.trim();
      if (!nextName) {
        setError("請輸入名字。");
        return;
      }
      if (nextName === session.name) {
        setRenamingName(false);
        setProfileNameDraft(session.name);
        return;
      }

      setSavingName(true);
      setError("");
      try {
        const updatedSession = await runWithFreshSession((activeSession) => updateGuestSessionName(activeSession.token, nextName));
        saveSession(updatedSession);
        setSession(updatedSession);
        setGuestName(updatedSession.name);
        setProfileNameDraft(updatedSession.name);
        setRenamingName(false);

        setRoom((currentRoom) => {
          if (!currentRoom) return currentRoom;
          return {
            ...currentRoom,
            seats: currentRoom.seats.map((seat) =>
              seat.playerId === updatedSession.playerId ? { ...seat, name: updatedSession.name } : seat
            ),
            ...(currentRoom.game
              ? {
                  game: {
                    ...currentRoom.game,
                    players: currentRoom.game.players.map((player) =>
                      player.playerId === updatedSession.playerId ? { ...player, name: updatedSession.name } : player
                    )
                  }
                }
              : {})
          };
        });
        setGame((currentGame) =>
          currentGame
            ? {
                ...currentGame,
                players: currentGame.players.map((player) =>
                  player.playerId === updatedSession.playerId ? { ...player, name: updatedSession.name } : player
                )
              }
            : currentGame
        );
      } catch (caught) {
        if (caught instanceof AuthExpiredError) {
          handleAuthExpired();
          return;
        }
        setError(caught instanceof Error ? caught.message : "更新名字失敗。");
      } finally {
        setSavingName(false);
      }
    },
    [handleAuthExpired, profileNameDraft, runWithFreshSession, savingName, session]
  );

  const cancelProfileRename = useCallback(() => {
    setProfileNameDraft(session?.name ?? "");
    setRenamingName(false);
  }, [session?.name]);

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
        applyServerTime(snapshot.serverTime);
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
    [applyServerTime, handleAuthExpired, room, runWithFreshSession, session]
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
        socket.emit("game.kong", { tileIds: action.tileIds ?? [], ...(action.meldId ? { meldId: action.meldId } : {}) });
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

  const identityControl = session ? (
    renamingName ? (
      <form className="identity identityEditor" onSubmit={saveProfileName}>
        <label className="identityNameField">
          <span>目前身分</span>
          <input
            value={profileNameDraft}
            maxLength={20}
            onChange={(event) => setProfileNameDraft(event.target.value)}
            placeholder="輸入新的名字"
            autoComplete="nickname"
            autoFocus
          />
        </label>
        <div className="identityEditActions">
          <button className="smallIconButton" type="submit" disabled={savingName || !profileNameDraft.trim()} title="儲存名字">
            {savingName ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
          </button>
          <button className="smallIconButton danger" type="button" onClick={cancelProfileRename} disabled={savingName} title="取消">
            <X size={16} />
          </button>
        </div>
      </form>
    ) : (
      <div className="identity">
        <span>目前身分</span>
        <strong>{session.name}</strong>
        <button
          className="smallIconButton"
          type="button"
          onClick={() => {
            setProfileNameDraft(session.name);
            setRenamingName(true);
          }}
          title="更改名字"
        >
          <Pencil size={16} />
        </button>
      </div>
    )
  ) : null;

  return (
    <main className={room ? (activeGame ? "appShell gameAppShell" : "appShell roomLobbyShell") : "appShell lobbyAppShell"}>
      <MusicDirector track={activeMusicTrack} volume={musicVolume} />

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
          {identityControl}
          <div className="modePicker" role="group" aria-label="選擇玩法">
            {(["taiwan", "riichi"] as const).map((mode) => (
              <button key={mode} className={selectedMode === mode ? "modeOption active" : "modeOption"} onClick={() => setSelectedMode(mode)}>
                {modeLabels[mode]}
              </button>
            ))}
          </div>
          <RoomSettingsPanel
            mode={selectedMode}
            config={roomConfig}
            onChange={setRoomConfig}
            onReset={() => setRoomConfig(defaultRoomConfig(selectedMode))}
          />
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
              <AudioSettingsButton volume={musicVolume} onClick={() => setShowAudioSettings(true)} />
              <button className="iconButton" onClick={() => setShowPatternCatalog(true)} title="牌型目錄">
                <BookOpen size={18} />
              </button>
              <button className="iconButton" onClick={copyCode} title="複製房號">
                <Copy size={18} />
              </button>
              <button className="iconButton danger" onClick={leaveRoom} title="離開房間">
                <DoorOpen size={18} />
              </button>
            </div>
          </header>

          {activeGame ? (
            <div className="gameScene activeGameScene">
              <div className="boardStack">
                <TableScreen
                  room={room}
                  game={game}
                  mySeatIndex={mySeat?.seatIndex}
                  privateMelds={privateState?.privateMelds ?? []}
                  myTurn={Boolean(myTurn)}
                  serverNow={serverNow}
                  latencyMs={latencyMs}
                />
                <ActionDock actions={visibleActions} hand={privateState?.hand ?? []} claimDiscard={game?.claimWindow?.discard} onAction={triggerAction} />
                <Hand
                  tiles={privateState?.hand ?? []}
                  winningTiles={privateState?.winningTiles ?? []}
                  showTingHint={showHandTingHint}
                  discardableIds={discardableIds}
                  selectedTileId={selectedTileId}
                  drawnTileId={privateState?.drawnTileId}
                  actionHintIds={actionHintIds}
                  onTileClick={discard}
                  myTurn={Boolean(myTurn)}
                />
              </div>
            </div>
          ) : (
            <RoomLobby
              room={room}
              game={game}
              myPlayerId={session.playerId}
              mySeatIndex={mySeat?.seatIndex}
              canManageSeats={canManageSeats}
              mySeatReady={mySeat?.ready}
              onReady={toggleReady}
              onAddBot={addBot}
              onClearSeat={clearSeat}
              identityControl={identityControl}
              serverNow={serverNow}
              latencyMs={latencyMs}
            />
          )}

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

          {showPatternCatalog && <PatternCatalog mode={room.mode} onClose={() => setShowPatternCatalog(false)} />}
          {showAudioSettings && (
            <AudioSettings volume={musicVolume} onVolumeChange={setMusicVolume} onClose={() => setShowAudioSettings(false)} />
          )}
        </section>
      )}
    </main>
  );
}

function stableIndex(value: string, size: number): number {
  if (size <= 0) return 0;

  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % size;
}
