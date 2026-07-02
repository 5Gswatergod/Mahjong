import { musicAssetPaths } from "./musicAssets";
import { tileAssetPaths } from "./tileAssets";

const imageAssetPaths = ["/backgrounds/game-table-bg.png", ...tileAssetPaths];
const audioAssetPaths = [...musicAssetPaths];

type AssetKind = "image" | "audio";

interface PreloadableAsset {
  kind: AssetKind;
  path: string;
}

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
  const uniqueAssets = uniquePreloadableAssets([
    ...imageAssetPaths.map((path) => ({ kind: "image" as const, path })),
    ...audioAssetPaths.map((path) => ({ kind: "audio" as const, path }))
  ]);
  const failedPaths: string[] = [];

  for (const [index, asset] of uniqueAssets.entries()) {
    onProgress({ loaded: index, total: uniqueAssets.length, currentPath: asset.path });
    const loaded = await loadAssetWithRetries(asset, 2);
    if (!loaded) {
      failedPaths.push(asset.path);
    }
    onProgress({ loaded: index + 1, total: uniqueAssets.length, currentPath: asset.path });
  }

  return { failedPaths };
}

function uniquePreloadableAssets(assets: PreloadableAsset[]): PreloadableAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (seen.has(asset.path)) {
      return false;
    }
    seen.add(asset.path);
    return true;
  });
}

async function loadAssetWithRetries(asset: PreloadableAsset, retries: number): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      if (asset.kind === "image") {
        await loadImage(asset.path, 8_000);
      } else {
        await loadAudio(asset.path, 12_000);
      }
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

function loadAudio(path: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      reject(new Error(`Timed out loading ${path}`));
    }, timeoutMs);

    fetch(path, { cache: "force-cache", signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed loading ${path}`);
        }
        return response.arrayBuffer();
      })
      .then(() => {
        window.clearTimeout(timeout);
        resolve();
      })
      .catch((error: unknown) => {
        window.clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(`Failed loading ${path}`));
      });
  });
}
