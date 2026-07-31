import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPublicAssetVersions } from "./buildAssetVersions.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("public asset content fingerprints", () => {
  it("keeps unchanged files stable and invalidates only changed content", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mahjong-assets-"));
    temporaryDirectories.push(directory);
    mkdirSync(path.join(directory, "tiles"));
    mkdirSync(path.join(directory, "music"));
    writeFileSync(path.join(directory, "tiles", "one.svg"), "tile-v1");
    writeFileSync(path.join(directory, "music", "menu.mp3"), "music-v1");

    const before = createPublicAssetVersions(directory);
    const unchanged = createPublicAssetVersions(directory);
    writeFileSync(path.join(directory, "tiles", "one.svg"), "tile-v2");
    const after = createPublicAssetVersions(directory);

    expect(unchanged).toEqual(before);
    expect(after["/tiles/one.svg"]).not.toBe(before["/tiles/one.svg"]);
    expect(after["/music/menu.mp3"]).toBe(before["/music/menu.mp3"]);
  });
});
