export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

let refresh: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refresh) {
    refresh = fetch("/backend/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "x-requested-with": "lizon" },
    }).then((response) => response.ok).finally(() => {
      refresh = null;
    });
  }
  return refresh;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("x-requested-with", "lizon");
  const response = await fetch(`/backend${path}`, { ...init, headers, credentials: "include" });
  if (response.status === 401 && retry && !path.startsWith("/api/auth/")) {
    const ok = await refreshSession();
    if (ok) return api<T>(path, init, false);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.message || response.statusText, data.code);
  return data as T;
}

export async function uploadFile(file: File) {
  const body = new FormData();
  body.append("file", file);
  return api<{ id: string; filename: string; mime: string }>("/api/files", { method: "POST", body });
}

export interface Actor {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  locale: string;
  theme: string;
  accent: string | null;
  roles: string[];
  permissions: string[];
  customFields: Record<string, unknown>;
}
