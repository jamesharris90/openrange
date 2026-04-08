import { API_BASE } from "@/lib/apiBase";

export const dynamic = "force-dynamic";

function normalizeSymbolForAPI(symbol: string): string {
  const upper = String(symbol || "").trim().toUpperCase();
  if (upper === "VIX") return "^VIX";
  if (upper === "SPX") return "^GSPC";
  return upper;
}

function normalizeQuotesPayload(payload: unknown) {
  const raw = payload as { data?: Array<Record<string, unknown>> };
  if (!Array.isArray(raw?.data)) return payload;

  return {
    ...(payload as Record<string, unknown>),
    data: raw.data.map((row) => {
      const symbol = String(row.symbol || "").toUpperCase();
      if (symbol === "VIX") {
        return { ...row, symbol: "^VIX" };
      }
      if (symbol === "GSPC") {
        return { ...row, symbol: "^GSPC" };
      }
      return row;
    }),
  };
}

function buildForwardHeaders(req: Request): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const auth = req.headers.get("authorization");
  if (auth) headers.authorization = auth;

  const apiKey = req.headers.get("x-api-key") || process.env.PROXY_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;

  return headers;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = url.searchParams.get("symbols") || "";
  const normalized = symbols
    .split(",")
    .map((symbol) => normalizeSymbolForAPI(symbol))
    .filter(Boolean)
    .join(",");

  const search = normalized ? `?symbols=${encodeURIComponent(normalized)}` : "";

  const backendUrl = `${API_BASE}/api/market/quotes${search}`;
  const res = await fetch(backendUrl, {
    method: "GET",
    headers: buildForwardHeaders(req),
    cache: "no-store",
  });

  const data = normalizeQuotesPayload(await res.json());

  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}