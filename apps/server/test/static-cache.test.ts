import { describe, expect, it } from "vitest";
import {
  immutableAssetCacheControl,
  revalidatedAssetCacheControl,
  staticCacheControl
} from "../src/static-cache.js";

describe("static cache headers", () => {
  it.each([
    "/app/dist/assets/index-C3dt_lw2.js",
    "/app/dist/backgrounds/game-table-bg.png",
    "/app/dist/music/menu/main-menu-01-loop.mp3",
    "C:\\app\\dist\\tiles\\characters\\1.svg"
  ])("keeps content-versioned assets immutable for one year: %s", (filePath) => {
    expect(staticCacheControl(filePath)).toBe(immutableAssetCacheControl);
  });

  it.each([
    "/app/dist/index.html",
    "/app/dist/brand/site.webmanifest",
    "/app/dist/brand/favicon-32.png",
    "/app/dist/robots.txt"
  ])("requires revalidation for entry points and unversioned files: %s", (filePath) => {
    expect(staticCacheControl(filePath)).toBe(revalidatedAssetCacheControl);
  });
});
