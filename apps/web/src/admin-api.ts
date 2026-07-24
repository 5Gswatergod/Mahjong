import type {
  AdminCloseRoomResponse,
  AdminDashboardResponse,
  AdminSessionResponse
} from "@taiwan-mahjong/shared";

export class AdminUnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminUnauthorizedError";
  }
}

export async function readAdminSession(): Promise<AdminSessionResponse> {
  return adminRequest<AdminSessionResponse>("/api/admin/session", { method: "GET" });
}

export async function loginAdmin(password: string): Promise<AdminSessionResponse> {
  return adminRequest<AdminSessionResponse>("/api/admin/session", {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export async function logoutAdmin(): Promise<AdminSessionResponse> {
  return adminRequest<AdminSessionResponse>("/api/admin/session", { method: "DELETE" });
}

export async function readAdminDashboard(): Promise<AdminDashboardResponse> {
  return adminRequest<AdminDashboardResponse>("/api/admin/dashboard", { method: "GET" });
}

export async function closeAdminRoom(roomCode: string, reason: string): Promise<AdminCloseRoomResponse> {
  return adminRequest<AdminCloseRoomResponse>(`/api/admin/rooms/${encodeURIComponent(roomCode)}/close`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {})
  });
}

async function adminRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {})
    }
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const message = errorMessage(payload, "管理員後台請求失敗。");
    if (response.status === 401) {
      throw new AdminUnauthorizedError(message);
    }
    throw new Error(message);
  }
  return payload as T;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
    return payload.message;
  }
  return fallback;
}
