import { gameTableBackgroundUrl } from "./publicAssets.js";
import { tileAssetPaths } from "./tileAssets.js";

export const criticalAssetPaths = [gameTableBackgroundUrl, ...tileAssetPaths];
export const criticalAssetStorageKey = "taiwanMahjong.preloadedAssetVersion";
export const criticalAssetFingerprint = fingerprintAssetPaths(criticalAssetPaths);

const preloadConcurrency = 6;

export interface AssetPreloadProgress {
  loaded: number;
  total: number;
  currentPath: string;
}

export interface AssetPreloadResult {
  failedPaths: string[];
}

type AssetPreloadListener = (progress: AssetPreloadProgress) => void;
type AssetVersionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface AssetPreloadSession {
  listeners: Set<AssetPreloadListener>;
  progress: AssetPreloadProgress;
  promise: Promise<AssetPreloadResult>;
}

const initialProgress: AssetPreloadProgress = {
  loaded: 0,
  total: criticalAssetPaths.length,
  currentPath: ""
};

let preloadSession: AssetPreloadSession | undefined;

export async function preloadGameAssets(
  onProgress: AssetPreloadListener,
  options: { forceReload?: boolean } = {}
): Promise<AssetPreloadResult> {
  if (options.forceReload) {
    preloadSession = undefined;
  }

  preloadSession ??= createPreloadSession();
  preloadSession.listeners.add(onProgress);
  onProgress(preloadSession.progress);

  try {
    return await preloadSession.promise;
  } finally {
    preloadSession.listeners.delete(onProgress);
  }
}

export function hasCompletedCriticalAssetPreload(storage: AssetVersionStorage | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(criticalAssetStorageKey) === criticalAssetFingerprint;
  } catch {
    return false;
  }
}

export function rememberCompletedCriticalAssetPreload(storage: AssetVersionStorage | undefined = browserStorage()): void {
  try {
    storage?.setItem(criticalAssetStorageKey, criticalAssetFingerprint);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function clearCompletedCriticalAssetPreload(storage: AssetVersionStorage | undefined = browserStorage()): void {
  try {
    storage?.removeItem(criticalAssetStorageKey);
  } catch {
    // A failed cache marker cleanup must not prevent the app from starting.
  }
}

export function persistCriticalAssetPreloadResult(
  result: AssetPreloadResult,
  storage: AssetVersionStorage | undefined = browserStorage()
): void {
  if (result.failedPaths.length === 0) {
    rememberCompletedCriticalAssetPreload(storage);
  } else {
    clearCompletedCriticalAssetPreload(storage);
  }
}

export function fingerprintAssetPaths(paths: readonly string[]): string {
  let hash = 0x811c9dc5;

  for (const path of paths) {
    for (let index = 0; index < path.length; index += 1) {
      hash ^= path.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0;
    hash = Math.imul(hash, 0x01000193);
  }

  return `assets-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function loadAssetsConcurrently(
  paths: readonly string[],
  load: (path: string) => Promise<boolean>,
  concurrency: number,
  onProgress: AssetPreloadListener
): Promise<AssetPreloadResult> {
  const uniquePaths = [...new Set(paths)];
  const failed = new Set<string>();
  let nextIndex = 0;
  let completed = 0;

  onProgress({ loaded: 0, total: uniquePaths.length, currentPath: "" });

  const worker = async () => {
    while (nextIndex < uniquePaths.length) {
      const assetPath = uniquePaths[nextIndex];
      nextIndex += 1;
      if (!assetPath) {
        return;
      }

      const loaded = await load(assetPath);
      if (!loaded) {
        failed.add(assetPath);
      }
      completed += 1;
      onProgress({ loaded: completed, total: uniquePaths.length, currentPath: assetPath });
    }
  };

  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), uniquePaths.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return { failedPaths: uniquePaths.filter((path) => failed.has(path)) };
}

function createPreloadSession(): AssetPreloadSession {
  const listeners = new Set<AssetPreloadListener>();
  const session: AssetPreloadSession = {
    listeners,
    progress: initialProgress,
    promise: Promise.resolve({ failedPaths: [] })
  };

  const report = (progress: AssetPreloadProgress) => {
    session.progress = progress;
    listeners.forEach((listener) => listener(progress));
  };

  session.promise = loadAssetsConcurrently(
    criticalAssetPaths,
    (path) => loadImageWithRetries(path, 2),
    preloadConcurrency,
    report
  );

  return session;
}

async function loadImageWithRetries(path: string, retries: number): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await loadImage(path, 8_000);
      return true;
    } catch {
      if (attempt === retries) {
        return false;
      }
    }
  }
  return false;
}

function loadImage(path: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out loading ${path}`));
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
    };

    image.onload = () => {
      cleanup();
      resolve();
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`Failed loading ${path}`));
    };
    image.decoding = "async";
    image.src = path;
  });
}

function browserStorage(): AssetVersionStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}
