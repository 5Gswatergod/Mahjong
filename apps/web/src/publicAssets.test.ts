import { describe, expect, it } from "vitest";
import { publicAssetUrl } from "./publicAssets.js";

describe("public asset URLs", () => {
  it("keeps the same URL while the content fingerprint stays unchanged", () => {
    const versions = { "/tiles/characters/1.svg": "abc123" };

    expect(publicAssetUrl("/tiles/characters/1.svg", versions)).toBe("/tiles/characters/1.svg?v=abc123");
    expect(publicAssetUrl("/tiles/characters/1.svg", versions)).toBe("/tiles/characters/1.svg?v=abc123");
  });

  it("changes only the URL whose content fingerprint changed", () => {
    const before = {
      "/tiles/characters/1.svg": "old-tile",
      "/music/menu/main-menu-01-loop.mp3": "same-music"
    };
    const after = {
      "/tiles/characters/1.svg": "new-tile",
      "/music/menu/main-menu-01-loop.mp3": "same-music"
    };

    expect(publicAssetUrl("/tiles/characters/1.svg", before)).not.toBe(
      publicAssetUrl("/tiles/characters/1.svg", after)
    );
    expect(publicAssetUrl("/music/menu/main-menu-01-loop.mp3", before)).toBe(
      publicAssetUrl("/music/menu/main-menu-01-loop.mp3", after)
    );
  });

  it("leaves unknown paths unchanged", () => {
    expect(publicAssetUrl("/missing.png", {})).toBe("/missing.png");
  });
});
