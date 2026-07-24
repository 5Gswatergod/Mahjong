import { describe, expect, it } from "vitest";
import type { AdminAuditEntry, PlayerSeat } from "@taiwan-mahjong/shared";
import { AdminSessionManager, buildAdminDashboard } from "../src/admin.js";

describe("admin sessions", () => {
  it("stays disabled until an admin password is configured", () => {
    const sessions = new AdminSessionManager(undefined);

    expect(sessions.configured).toBe(false);
    expect(sessions.login("anything", "127.0.0.1", 1_000)).toEqual({ status: "unconfigured" });
  });

  it("creates an expiring session only for the configured password", () => {
    const sessions = new AdminSessionManager("correct horse battery staple", {
      sessionTtlMs: 1_000,
      createToken: () => "admin_test_token"
    });

    expect(sessions.login("wrong", "127.0.0.1", 1_000)).toEqual({ status: "invalid" });
    expect(sessions.login("correct horse battery staple", "127.0.0.1", 1_100)).toEqual({
      status: "ok",
      token: "admin_test_token",
      expiresAt: 2_100
    });
    expect(sessions.getExpiresAt("admin_test_token", 2_099)).toBe(2_100);
    expect(sessions.getExpiresAt("admin_test_token", 2_100)).toBeUndefined();
  });

  it("temporarily blocks repeated failed logins per client", () => {
    const sessions = new AdminSessionManager("secret", {
      loginWindowMs: 10_000,
      maxLoginFailures: 2,
      createToken: () => "admin_after_lockout"
    });

    expect(sessions.login("wrong", "client-a", 1_000).status).toBe("invalid");
    expect(sessions.login("wrong", "client-a", 2_000)).toEqual({ status: "rateLimited", retryAfterSeconds: 10 });
    expect(sessions.login("secret", "client-a", 5_000)).toEqual({ status: "rateLimited", retryAfterSeconds: 7 });
    expect(sessions.login("secret", "client-a", 12_000).status).toBe("ok");
  });
});

describe("admin dashboard", () => {
  it("summarizes public room operations without exposing private hands", () => {
    const seats: PlayerSeat[] = [
      {
        seatIndex: 0,
        wind: "east",
        playerId: "player_host",
        name: "房主",
        coins: 10_000,
        ready: true,
        connected: true
      },
      {
        seatIndex: 1,
        wind: "south",
        playerId: "bot_1",
        name: "電腦 2",
        isBot: true,
        coins: 10_000,
        ready: true,
        connected: true
      },
      { seatIndex: 2, wind: "west", coins: 10_000, ready: false, connected: false },
      { seatIndex: 3, wind: "north", coins: 10_000, ready: false, connected: false }
    ];
    const action: AdminAuditEntry = {
      id: "action_1",
      action: "room.closed",
      roomCode: "OLD123",
      createdAt: 900
    };

    const dashboard = buildAdminDashboard({
      rooms: [
        {
          code: "ABC123",
          mode: "taiwan",
          hostPlayerId: "player_host",
          seats,
          phase: "playing",
          handId: "hand_public_id",
          wallCount: 62,
          spectators: 3,
          createdAt: 500,
          updatedAt: 950
        }
      ],
      recentActions: [action],
      startedAt: 0,
      persistence: "memory",
      now: 1_000
    });

    expect(dashboard.totals).toMatchObject({
      rooms: 1,
      activeGames: 1,
      humanPlayers: 1,
      bots: 1,
      connectedPlayers: 1,
      spectators: 3,
      taiwanRooms: 1,
      riichiRooms: 0
    });
    expect(dashboard.rooms[0]).toMatchObject({
      code: "ABC123",
      phase: "playing",
      handId: "hand_public_id",
      wallCount: 62
    });
    expect(dashboard.rooms[0]?.seats[0]).toMatchObject({ name: "房主", isHost: true, isBot: false });
    expect(dashboard.rooms[0]?.seats[1]).toMatchObject({ name: "電腦 2", isHost: false, isBot: true });
    expect(JSON.stringify(dashboard)).not.toContain("hand:");
    expect(dashboard.recentActions).toEqual([action]);
  });
});
