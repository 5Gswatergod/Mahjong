import { Loader2, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { preloadGameAssets, type AssetPreloadProgress } from "../assetPreloader";

type AssetInitState =
  | { status: "loading"; progress: AssetPreloadProgress }
  | { status: "ready"; failedCount: number; retrying: boolean };

const initialProgress: AssetPreloadProgress = {
  loaded: 0,
  total: 1,
  currentPath: ""
};

export function AssetInitializer({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AssetInitState>({ status: "loading", progress: initialProgress });
  const [reloadToken, setReloadToken] = useState(0);

  const retry = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void preloadGameAssets(
      (progress) => {
        if (!cancelled) {
          setState((current) =>
            current.status === "ready" ? { ...current, retrying: true } : { status: "loading", progress }
          );
        }
      },
      { forceReload: reloadToken > 0 }
    ).then(({ failedPaths }) => {
      if (cancelled) return;

      setState({ status: "ready", failedCount: failedPaths.length, retrying: false });
    });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  if (state.status === "ready") {
    return (
      <>
        {children}
        {state.failedCount > 0 ? (
          <div className="assetWarning" role="status">
            <span>部分素材載入失敗，已先進入遊戲</span>
            <button className="assetWarningButton" type="button" onClick={retry} disabled={state.retrying}>
              <RefreshCw className={state.retrying ? "spin" : undefined} size={16} />
              {state.retrying ? "重試中" : "重試素材"}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  const percent = Math.round((state.progress.loaded / Math.max(state.progress.total, 1)) * 100);

  return (
    <main className="assetInitShell">
      <section className="assetInitPanel" aria-live="polite">
        <span className="brandTile">雀</span>
        <div className="assetInitCopy">
          <h1>正在準備牌桌</h1>
          <p>載入牌面與牌桌素材</p>
        </div>
        <div className="assetInitProgress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <strong>{percent}%</strong>
        <Loader2 className="spin" size={24} />
      </section>
    </main>
  );
}
