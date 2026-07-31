import { describe, expect, it } from "vitest";
import {
  buildRoomPath,
  buildRoomUrl,
  buildSpectatorPath,
  buildSpectatorUrl,
  readRoomEntryTarget,
  readSpectatorRoomCode
} from "./spectatorUrl.js";

describe("room URLs", () => {
  it("reads a canonical room link as automatic entry", () => {
    expect(readRoomEntryTarget("/room/ab12cd")).toEqual({ roomCode: "AB12CD", intent: "auto" });
    expect(readRoomEntryTarget("/room/AB12CD/")).toEqual({ roomCode: "AB12CD", intent: "auto" });
  });

  it("keeps legacy spectator links in explicit spectator mode", () => {
    expect(readRoomEntryTarget("/spectate/ab12cd")).toEqual({ roomCode: "AB12CD", intent: "spectator" });
  });

  it("ignores unrelated or invalid room paths", () => {
    expect(readRoomEntryTarget("/rooms/AB12CD")).toBeNull();
    expect(readRoomEntryTarget("/room/ABC")).toBeNull();
    expect(readRoomEntryTarget("/room/AB12CD/extra")).toBeNull();
  });

  it("builds a canonical shareable room URL", () => {
    expect(buildRoomPath(" ab12cd ")).toBe("/room/AB12CD");
    expect(buildRoomUrl("https://mahjong.example", "ab12cd")).toBe("https://mahjong.example/room/AB12CD");
  });
});

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
