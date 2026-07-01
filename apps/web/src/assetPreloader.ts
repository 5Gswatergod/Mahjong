import { tileAssetPaths } from "./tileAssets";

const imageAssetPaths = ["/backgrounds/game-table-bg.png", ...tileAssetPaths];

export interface AssetPreloadProgress {
  loaded: number;
  total: number;
  currentPath: string;
}

export interface AssetPreloadResult {
  failedPaths: string[];
}

type AssetPreloadListener = (progress: AssetPreloadProgress) => void;

interface AssetPreloadSession {
  listeners: Set<AssetPreloadListener>;
  progress: AssetPreloadProgress;
  promise: Promise<AssetPreloadResult>;
}

const initialProgress: AssetPreloadProgress = {
  loaded: 0,
  total: 1,
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

  session.promise = preloadAssets(report);

  return session;
}

async function preloadAssets(onProgress: AssetPreloadListener): Promise<AssetPreloadResult> {
  const uniquePaths = [...new Set(imageAssetPaths)];
  const failedPaths: string[] = [];

  for (const [index, path] of uniquePaths.entries()) {
    onProgress({ loaded: index, total: uniquePaths.length, currentPath: path });
    const loaded = await loadImageWithRetries(path, 2);
    if (!loaded) {
      failedPaths.push(path);
    }
    onProgress({ loaded: index + 1, total: uniquePaths.length, currentPath: path });
  }

  return { failedPaths };
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
