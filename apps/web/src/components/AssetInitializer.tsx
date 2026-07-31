import { Loader2, RefreshCw, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  hasCompletedCriticalAssetPreload,
  persistCriticalAssetPreloadResult,
  preloadGameAssets,
  type AssetPreloadProgress
} from "../assetPreloader";
import { BrandMark } from "./BrandMark";

type AssetInitState =
  | { status: "loading"; progress: AssetPreloadProgress }
  | { status: "ready"; failedCount: number; retrying: boolean };

const initialProgress: AssetPreloadProgress = {
  loaded: 0,
  total: 1,
  currentPath: ""
};

export function AssetInitializer({ children }: { children: ReactNode }) {
  const [shouldBlockInitialLoad] = useState(() => !hasCompletedCriticalAssetPreload());
  const [state, setState] = useState<AssetInitState>(() =>
    shouldBlockInitialLoad
      ? { status: "loading", progress: initialProgress }
      : { status: "ready", failedCount: 0, retrying: false }
  );
  const [reloadToken, setReloadToken] = useState(0);
  const [dismissedFailureCount, setDismissedFailureCount] = useState(0);

  const retry = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isRetry = reloadToken > 0;

    void preloadGameAssets(
      (progress) => {
        if (!cancelled) {
          setState((current) =>
            current.status === "ready"
              ? isRetry
                ? { ...current, retrying: true }
                : current
              : { status: "loading", progress }
          );
        }
      },
      { forceReload: isRetry }
    ).then(({ failedPaths }) => {
      if (cancelled) return;

      persistCriticalAssetPreloadResult({ failedPaths });
      setState({ status: "ready", failedCount: failedPaths.length, retrying: false });
      setDismissedFailureCount(0);
    });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (state.status !== "ready" || state.failedCount <= 0 || dismissedFailureCount === state.failedCount) {
      return;
    }

    const warningTimer = window.setTimeout(() => {
      setDismissedFailureCount(state.failedCount);
    }, 6000);

    return () => window.clearTimeout(warningTimer);
  }, [dismissedFailureCount, state]);

  if (state.status === "ready") {
    const showWarning = state.failedCount > 0 && dismissedFailureCount !== state.failedCount;

    return (
      <>
        {children}
        {showWarning ? (
          <div className="assetWarning" role="status">
            <span>部分素材載入失敗，已先進入遊戲</span>
            <button className="assetWarningButton" type="button" onClick={retry} disabled={state.retrying}>
              <RefreshCw className={state.retrying ? "spin" : undefined} size={16} />
              {state.retrying ? "重試中" : "重試素材"}
            </button>
            <button
              className="assetWarningClose"
              type="button"
              onClick={() => setDismissedFailureCount(state.failedCount)}
              title="關閉素材提示"
            >
              <X size={16} />
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
        <BrandMark />
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
