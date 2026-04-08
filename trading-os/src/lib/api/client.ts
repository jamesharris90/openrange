import { CLIENT_API_BASE } from "@/lib/apiBase";

const LOCKED_API_BASE = String(CLIENT_API_BASE || "").trim().replace(/\/$/, "");
console.log("API BASE LOCKED:", LOCKED_API_BASE);

function normalizeApiPath(path: string) {
  const raw = String(path || "").trim();

  if (!raw) {
    return LOCKED_API_BASE || "/api";
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (raw === LOCKED_API_BASE || raw.startsWith(`${LOCKED_API_BASE}/`)) {
    return raw;
  }

  if (raw === "/api" || raw.startsWith("/api/")) {
    return raw;
  }

  if (!LOCKED_API_BASE) {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  return `${LOCKED_API_BASE}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  let token: string | null = null;
  try {
    token = localStorage.getItem("token");
  } catch {
    token = null;
  }

  const requestInit: RequestInit = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  };

  return fetch(normalizeApiPath(path), requestInit);
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, {
    ...init,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API request failed (${response.status}) for ${path}`);
  }

  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, {
    method: "POST",
    ...init,
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API request failed (${response.status}) for ${path}`);
  }

  return (await response.json()) as T;
}
