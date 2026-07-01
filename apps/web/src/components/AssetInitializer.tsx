import { Loader2, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { preloadGameAssets, type AssetPreloadProgress } from "../assetPreloader";

type AssetInitState =
  | { status: "loading"; progress: AssetPreloadProgress }
  | { status: "ready" }
  | { status: "failed"; progress: AssetPreloadProgress; failedCount: number };

const initialProgress: AssetPreloadProgress = {
  loaded: 0,
  total: 1,
  currentPath: ""
};

export function AssetInitializer({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AssetInitState>({ status: "loading", progress: initialProgress });
  const [reloadToken, setReloadToken] = useState(0);

  const retry = useCallback(() => {
    setState({ status: "loading", progress: initialProgress });
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void preloadGameAssets(
      (progress) => {
        if (!cancelled) {
          setState({ status: "loading", progress });
        }
      },
      { forceReload: reloadToken > 0 }
    ).then(({ failedPaths }) => {
      if (cancelled) return;

      if (failedPaths.length > 0) {
        setState((current) => ({
          status: "failed",
          progress: current.status === "loading" ? current.progress : initialProgress,
          failedCount: failedPaths.length
        }));
        return;
      }

      setState({ status: "ready" });
    });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  if (state.status === "ready") {
    return <>{children}</>;
  }

  const percent = Math.round((state.progress.loaded / Math.max(state.progress.total, 1)) * 100);

  return (
    <main className="assetInitShell">
      <section className="assetInitPanel" aria-live="polite">
        <span className="brandTile">雀</span>
        <div className="assetInitCopy">
          <h1>正在準備牌桌</h1>
          <p>{state.status === "failed" ? `有 ${state.failedCount} 個素材載入失敗` : "載入牌面與牌桌素材"}</p>
        </div>
        <div className="assetInitProgress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <strong>{percent}%</strong>
        {state.status === "failed" ? (
          <button className="secondaryButton" type="button" onClick={retry}>
            <RefreshCw size={18} />
            重新載入
          </button>
        ) : (
          <Loader2 className="spin" size={24} />
        )}
      </section>
    </main>
  );
}
