export const CLIENT_API_BASE = "/api";

function normalizeServerBackendBase(url: string): string {
  if (!url) return url;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      return parsed.toString().replace(/\/$/, "");
    }
    return url;
  } catch {
    return url;
  }
}

const rawBackendApiBase =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://localhost:3007";

export const BACKEND_API_BASE = normalizeServerBackendBase(rawBackendApiBase);

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://localhost:3000";

export const API_BASE = typeof window === "undefined"
  ? BACKEND_API_BASE
  : CLIENT_API_BASE;

export default API_BASE;
