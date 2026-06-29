import type { GuestAuthResponse } from "@taiwan-mahjong/shared";

const sessionStorageKey = "mahjong.guestSession";

export class AuthExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthExpiredError";
  }
}

export async function api<T>(path: string, token: string, init: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...headers
    }
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const message = errorMessage(payload, "Request failed.");
    if (response.status === 401) {
      throw new AuthExpiredError(message);
    }
    throw new Error(message);
  }
  return payload as T;
}

export async function requestGuestSession(name: string | undefined): Promise<GuestAuthResponse> {
  const response = await fetch("/api/auth/guest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name || undefined })
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(payload, "建立訪客身分失敗。"));
  }
  return payload as GuestAuthResponse;
}

export function saveSession(session: GuestAuthResponse): void {
  localStorage.setItem(sessionStorageKey, JSON.stringify(session));
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

export function readSession(): GuestAuthResponse | null {
  const raw = localStorage.getItem(sessionStorageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GuestAuthResponse;
  } catch {
    localStorage.removeItem(sessionStorageKey);
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(sessionStorageKey);
}
