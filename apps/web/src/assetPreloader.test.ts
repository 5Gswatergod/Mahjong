import { describe, expect, it } from "vitest";
import {
  clearCompletedCriticalAssetPreload,
  criticalAssetFingerprint,
  criticalAssetPaths,
  criticalAssetStorageKey,
  hasCompletedCriticalAssetPreload,
  loadAssetsConcurrently,
  persistCriticalAssetPreloadResult,
  rememberCompletedCriticalAssetPreload
} from "./assetPreloader.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
}

describe("critical asset preload state", () => {
  it("contains only the table background and all 42 tile faces", () => {
    expect(criticalAssetPaths).toHaveLength(43);
    expect(criticalAssetPaths.some((path) => path.startsWith("/backgrounds/"))).toBe(true);
    expect(criticalAssetPaths.some((path) => path.startsWith("/music/"))).toBe(false);
  });

  it("recognizes only the current successful asset fingerprint", () => {
    const storage = memoryStorage();

    expect(hasCompletedCriticalAssetPreload(storage)).toBe(false);
    rememberCompletedCriticalAssetPreload(storage);
    expect(storage.getItem(criticalAssetStorageKey)).toBe(criticalAssetFingerprint);
    expect(hasCompletedCriticalAssetPreload(storage)).toBe(true);
    storage.setItem(criticalAssetStorageKey, "an-older-version");
    expect(hasCompletedCriticalAssetPreload(storage)).toBe(false);
    clearCompletedCriticalAssetPreload(storage);
    expect(storage.getItem(criticalAssetStorageKey)).toBeNull();
  });

  it("records only a completely successful preload", () => {
    const storage = memoryStorage();

    persistCriticalAssetPreloadResult({ failedPaths: [] }, storage);
    expect(hasCompletedCriticalAssetPreload(storage)).toBe(true);
    persistCriticalAssetPreloadResult({ failedPaths: ["/tiles/dots/1.svg"] }, storage);
    expect(hasCompletedCriticalAssetPreload(storage)).toBe(false);
  });
});

describe("critical asset loading", () => {
  it("limits concurrency, deduplicates paths, and reports failures in source order", async () => {
    let active = 0;
    let peakActive = 0;
    const progress: number[] = [];

    const result = await loadAssetsConcurrently(
      ["/one.svg", "/two.svg", "/three.svg", "/two.svg", "/four.svg"],
      async (path) => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await Promise.resolve();
        active -= 1;
        return path !== "/three.svg";
      },
      2,
      (state) => progress.push(state.loaded)
    );

    expect(peakActive).toBeLessThanOrEqual(2);
    expect(progress.at(-1)).toBe(4);
    expect(result.failedPaths).toEqual(["/three.svg"]);
  });
});
