import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AdminDashboardResponse, AdminRoomPhase, AdminRoomSummary, Wind } from "@taiwan-mahjong/shared";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock3,
  Database,
  DoorClosed,
  Eye,
  Gamepad2,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Server,
  ShieldCheck,
  Users,
  X
} from "lucide-react";
import {
  AdminUnauthorizedError,
  closeAdminRoom,
  loginAdmin,
  logoutAdmin,
  readAdminDashboard,
  readAdminSession
} from "../admin-api.js";
import { BrandMark } from "./BrandMark.js";
import "../admin.css";

type AdminAuthState = "checking" | "signedOut" | "signedIn";

const phaseLabels: Record<AdminRoomPhase, string> = {
  waiting: "等待入桌",
  seatDraw: "抓位中",
  playing: "對局中",
  claiming: "等待鳴牌",
  settled: "本局結算",
  draw: "流局結算"
};

const windLabels: Record<Wind, string> = {
  east: "東",
  south: "南",
  west: "西",
  north: "北"
};

export function AdminApp() {
  const [authState, setAuthState] = useState<AdminAuthState>("checking");
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null);
  const [expandedRoomCode, setExpandedRoomCode] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<AdminRoomSummary | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const nextDashboard = await readAdminDashboard();
      setDashboard(nextDashboard);
      setAuthState("signedIn");
      setError("");
    } catch (caught) {
      if (caught instanceof AdminUnauthorizedError) {
        setDashboard(null);
        setAuthState("signedOut");
        setError("管理員登入已過期，請重新登入。");
        return;
      }
      setError(caught instanceof Error ? caught.message : "無法載入管理資料。");
    } finally {
      if (showRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void readAdminSession()
      .then(async (session) => {
        if (!active) return;
        setConfigured(session.configured);
        if (!session.authenticated) {
          setAuthState("signedOut");
          return;
        }
        await loadDashboard();
      })
      .catch((caught) => {
        if (!active) return;
        setAuthState("signedOut");
        setError(caught instanceof Error ? caught.message : "無法確認管理員登入狀態。");
      });
    return () => {
      active = false;
    };
  }, [loadDashboard]);

  useEffect(() => {
    if (authState !== "signedIn") return;
    const timer = window.setInterval(() => void loadDashboard(), 10_000);
    return () => window.clearInterval(timer);
  }, [authState, loadDashboard]);

  const submitLogin = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!password) return;
      setBusy(true);
      setError("");
      try {
        const session = await loginAdmin(password);
        setConfigured(session.configured);
        setPassword("");
        await loadDashboard();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "登入失敗。");
      } finally {
        setBusy(false);
      }
    },
    [loadDashboard, password]
  );

  const handleLogout = useCallback(async () => {
    setBusy(true);
    try {
      await logoutAdmin();
    } finally {
      setDashboard(null);
      setAuthState("signedOut");
      setBusy(false);
    }
  }, []);

  const confirmCloseRoom = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!closeTarget) return;
      setBusy(true);
      setError("");
      try {
        await closeAdminRoom(closeTarget.code, closeReason.trim());
        setExpandedRoomCode(null);
        setCloseTarget(null);
        setCloseReason("");
        await loadDashboard();
      } catch (caught) {
        if (caught instanceof AdminUnauthorizedError) {
          setDashboard(null);
          setCloseTarget(null);
          setAuthState("signedOut");
        }
        setError(caught instanceof Error ? caught.message : "無法關閉房間。");
      } finally {
        setBusy(false);
      }
    },
    [closeReason, closeTarget, loadDashboard]
  );

  if (authState === "checking") {
    return (
      <main className="adminGateShell">
        <div className="adminGateCard adminGateLoading">
          <BrandMark />
          <Loader2 className="spin" size={28} />
          <p>正在確認管理員工作階段…</p>
        </div>
      </main>
    );
  }

  if (authState === "signedOut") {
    return (
      <main className="adminGateShell">
        <section className="adminGateCard">
          <div className="adminGateBrand">
            <BrandMark />
            <div>
              <span>雀局營運中心</span>
              <h1>管理員後台</h1>
            </div>
          </div>
          <div className="adminGateIntro">
            <ShieldCheck size={24} />
            <div>
              <strong>僅限授權管理員</strong>
              <p>監看房間與連線狀態，並處理卡住或異常的牌局。</p>
            </div>
          </div>
          {!configured ? (
            <div className="adminSetupNotice" role="alert">
              <AlertTriangle size={20} />
              <div>
                <strong>尚未啟用管理員登入</strong>
                <p>請先在伺服器環境設定 ADMIN_PASSWORD，再重新啟動服務。</p>
              </div>
            </div>
          ) : (
            <form className="adminLoginForm" onSubmit={submitLogin}>
              <label htmlFor="admin-password">管理員密碼</label>
              <div className="adminPasswordField">
                <KeyRound size={18} />
                <input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="輸入管理員密碼"
                  autoFocus
                />
              </div>
              <button className="adminPrimaryButton" type="submit" disabled={busy || !password}>
                {busy ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
                登入後台
              </button>
            </form>
          )}
          {error && <div className="adminInlineError">{error}</div>}
          <a className="adminBackLink" href="/">
            返回雀局
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="adminShell">
      <aside className="adminSidebar">
        <a className="adminSidebarBrand" href="/admin" aria-label="雀局管理員後台">
          <BrandMark compact />
          <div>
            <strong>雀局</strong>
            <span>營運中心</span>
          </div>
        </a>
        <nav aria-label="管理選單">
          <a className="active" href="#overview">
            <Activity size={18} />
            營運總覽
          </a>
          <a href="#rooms">
            <Gamepad2 size={18} />
            房間管理
          </a>
          <a href="#activity">
            <Clock3 size={18} />
            操作紀錄
          </a>
        </nav>
        <div className="adminSidebarFooter">
          <div className="adminIdentity">
            <ShieldCheck size={18} />
            <div>
              <strong>管理員</strong>
              <span>已安全登入</span>
            </div>
          </div>
          <button type="button" onClick={() => void handleLogout()} disabled={busy}>
            <LogOut size={17} />
            登出
          </button>
        </div>
      </aside>

      <section className="adminWorkspace">
        <header className="adminTopbar">
          <div>
            <p>雀局即時營運狀態</p>
            <h1>管理員後台</h1>
          </div>
          <div className="adminTopbarActions">
            <span className="adminLiveBadge">
              <span /> 每 10 秒更新
            </span>
            <button type="button" onClick={() => void loadDashboard(true)} disabled={refreshing}>
              <RefreshCw className={refreshing ? "spin" : ""} size={17} />
              立即更新
            </button>
          </div>
        </header>

        {error && (
          <div className="adminErrorBanner" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} title="關閉訊息">
              <X size={17} />
            </button>
          </div>
        )}

        {dashboard && (
          <>
            <section id="overview" className="adminSection">
              <div className="adminSectionHeading">
                <div>
                  <span>OVERVIEW</span>
                  <h2>營運總覽</h2>
                </div>
                <p>資料更新於 {formatTime(dashboard.generatedAt)}</p>
              </div>
              <div className="adminMetricGrid">
                <MetricCard icon={<Gamepad2 />} label="目前房間" value={dashboard.totals.rooms} detail={`${dashboard.totals.activeGames} 桌對局中`} tone="gold" />
                <MetricCard icon={<Users />} label="真人座位" value={dashboard.totals.humanPlayers} detail={`${dashboard.totals.connectedPlayers} 人已連線`} tone="teal" />
                <MetricCard icon={<Bot />} label="AI 玩家" value={dashboard.totals.bots} detail="所有房間合計" tone="blue" />
                <MetricCard icon={<Eye />} label="觀戰連線" value={dashboard.totals.spectators} detail="目前線上觀戰者" tone="rose" />
              </div>
              <div className="adminServerStrip">
                <div>
                  <Server size={20} />
                  <span>伺服器</span>
                  <strong className="healthy"><CircleDot size={13} /> 正常運作</strong>
                </div>
                <div>
                  <Clock3 size={19} />
                  <span>運行時間</span>
                  <strong>{formatDuration(dashboard.server.uptimeSeconds)}</strong>
                </div>
                <div>
                  <Database size={19} />
                  <span>事件儲存</span>
                  <strong className={dashboard.server.persistence === "postgres" ? "healthy" : "warning"}>
                    {dashboard.server.persistence === "postgres" ? "PostgreSQL" : "記憶體（重啟後清除）"}
                  </strong>
                </div>
                <div>
                  <Gamepad2 size={19} />
                  <span>玩法分布</span>
                  <strong>台灣 {dashboard.totals.taiwanRooms} · 日式 {dashboard.totals.riichiRooms}</strong>
                </div>
              </div>
            </section>

            <section id="rooms" className="adminSection">
              <div className="adminSectionHeading">
                <div>
                  <span>ROOMS</span>
                  <h2>房間管理</h2>
                </div>
                <p>只顯示公開對局資訊，不讀取玩家手牌。</p>
              </div>
              {dashboard.rooms.length === 0 ? (
                <div className="adminEmptyState">
                  <Gamepad2 size={30} />
                  <strong>目前沒有房間</strong>
                  <p>有玩家建立牌局後，會自動顯示在這裡。</p>
                </div>
              ) : (
                <div className="adminRoomList">
                  {dashboard.rooms.map((room) => (
                    <RoomCard
                      key={room.code}
                      room={room}
                      now={dashboard.generatedAt}
                      expanded={expandedRoomCode === room.code}
                      onToggle={() => setExpandedRoomCode((current) => (current === room.code ? null : room.code))}
                      onClose={() => {
                        setCloseReason("");
                        setCloseTarget(room);
                      }}
                    />
                  ))}
                </div>
              )}
            </section>

            <section id="activity" className="adminSection">
              <div className="adminSectionHeading">
                <div>
                  <span>ACTIVITY</span>
                  <h2>操作紀錄</h2>
                </div>
                <p>本次伺服器運行期間的管理動作。</p>
              </div>
              {dashboard.recentActions.length === 0 ? (
                <div className="adminEmptyState compact">
                  <ShieldCheck size={25} />
                  <strong>尚無管理操作</strong>
                </div>
              ) : (
                <div className="adminAuditList">
                  {dashboard.recentActions.map((entry) => (
                    <div key={entry.id}>
                      <div className="adminAuditIcon"><DoorClosed size={17} /></div>
                      <div>
                        <strong>關閉房間 {entry.roomCode}</strong>
                        <p>{entry.reason || "未填寫原因"}</p>
                      </div>
                      <time dateTime={new Date(entry.createdAt).toISOString()}>{formatDateTime(entry.createdAt)}</time>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </section>

      {closeTarget && (
        <div className="adminModalBackdrop" role="presentation" onMouseDown={() => !busy && setCloseTarget(null)}>
          <form className="adminConfirmDialog" role="dialog" aria-modal="true" aria-labelledby="close-room-title" onSubmit={confirmCloseRoom} onMouseDown={(event) => event.stopPropagation()}>
            <div className="adminDangerIcon"><DoorClosed size={24} /></div>
            <div>
              <span>高影響操作</span>
              <h2 id="close-room-title">關閉房間 {closeTarget.code}？</h2>
              <p>所有玩家與觀戰者會立即斷線，這個房間無法復原。</p>
            </div>
            <label htmlFor="close-reason">原因（選填，會通知房內玩家）</label>
            <input id="close-reason" maxLength={120} value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder="例如：牌局卡住、測試房間、異常使用" autoFocus />
            <div className="adminDialogActions">
              <button type="button" onClick={() => setCloseTarget(null)} disabled={busy}>取消</button>
              <button className="danger" type="submit" disabled={busy}>
                {busy ? <Loader2 className="spin" size={17} /> : <DoorClosed size={17} />}
                確認關閉房間
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function MetricCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: number; detail: string; tone: string }) {
  return (
    <article className={`adminMetricCard ${tone}`}>
      <div className="adminMetricIcon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value.toLocaleString("zh-TW")}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function RoomCard({ room, now, expanded, onToggle, onClose }: { room: AdminRoomSummary; now: number; expanded: boolean; onToggle: () => void; onClose: () => void }) {
  const occupiedSeats = useMemo(() => room.seats.filter((seat) => seat.name), [room.seats]);
  return (
    <article className={`adminRoomCard ${expanded ? "expanded" : ""}`}>
      <button className="adminRoomSummary" type="button" onClick={onToggle} aria-expanded={expanded}>
        <div className="adminRoomCode">
          <span className={`adminPhaseDot ${phaseTone(room.phase)}`} />
          <div><strong>{room.code}</strong><span>{room.mode === "taiwan" ? "台灣麻將" : "日式麻將"}</span></div>
        </div>
        <div className="adminRoomFact"><span>狀態</span><strong>{phaseLabels[room.phase]}</strong></div>
        <div className="adminRoomFact"><span>座位</span><strong>{room.humanPlayers + room.bots} / 4</strong></div>
        <div className="adminRoomFact"><span>連線</span><strong>{room.connectedPlayers} 人 · {room.spectators} 觀戰</strong></div>
        <div className="adminRoomFact"><span>最後活動</span><strong>{formatRelative(room.updatedAt, now)}</strong></div>
        <span className="adminRoomExpand">{expanded ? <ChevronUp size={19} /> : <ChevronDown size={19} />}</span>
      </button>
      {expanded && (
        <div className="adminRoomDetails">
          <div className="adminSeatGrid">
            {room.seats.map((seat) => (
              <div className={seat.name ? "adminSeat occupied" : "adminSeat"} key={seat.seatIndex}>
                <span className="adminWind">{windLabels[seat.wind]}</span>
                <div>
                  <strong>{seat.name ?? "空位"}</strong>
                  <span>
                    {seat.name ? `${seat.isBot ? "AI" : seat.connected ? "已連線" : "已離線"}${seat.isHost ? " · 房主" : ""}` : "等待玩家"}
                  </span>
                </div>
                {seat.name && <b>{seat.coins.toLocaleString("zh-TW")}</b>}
              </div>
            ))}
          </div>
          <div className="adminRoomMeta">
            <span>建立於 {formatDateTime(room.createdAt)}</span>
            {typeof room.wallCount === "number" && <span>牌牆剩餘 {room.wallCount} 張</span>}
            {room.handId && <span>牌局識別 {room.handId}</span>}
          </div>
          <div className="adminRoomDetailActions">
            <span>{occupiedSeats.length === 0 ? "空房間" : `${occupiedSeats.length} 個已使用座位`}</span>
            <button type="button" onClick={onClose}><DoorClosed size={17} /> 關閉房間</button>
          </div>
        </div>
      )}
    </article>
  );
}

function phaseTone(phase: AdminRoomPhase): string {
  if (phase === "playing" || phase === "claiming") return "active";
  if (phase === "seatDraw") return "starting";
  if (phase === "settled" || phase === "draw") return "settled";
  return "waiting";
}

function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小時`;
  if (hours > 0) return `${hours} 小時 ${minutes} 分`;
  return `${minutes} 分鐘`;
}

function formatRelative(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return "剛剛";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分前`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小時前`;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(timestamp);
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp);
}
