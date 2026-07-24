import { describe, expect, it } from "vitest";
import { buildSpectatorPath, buildSpectatorUrl, readSpectatorRoomCode } from "./spectatorUrl.js";

describe("spectator URLs", () => {
  it("reads and normalizes a spectator room code", () => {
    expect(readSpectatorRoomCode("/spectate/ab12cd")).toBe("AB12CD");
    expect(readSpectatorRoomCode("/spectate/AB12CD/")).toBe("AB12CD");
  });

  it("ignores unrelated or invalid paths", () => {
    expect(readSpectatorRoomCode("/rooms/AB12CD")).toBeNull();
    expect(readSpectatorRoomCode("/spectate/ABC")).toBeNull();
    expect(readSpectatorRoomCode("/spectate/AB12CD/extra")).toBeNull();
  });

  it("builds a canonical shareable spectator URL", () => {
    expect(buildSpectatorPath(" ab12cd ")).toBe("/spectate/AB12CD");
    expect(buildSpectatorUrl("https://mahjong.example", "ab12cd")).toBe("https://mahjong.example/spectate/AB12CD");
  });
});
