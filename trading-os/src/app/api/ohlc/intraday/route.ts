import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/config/apiBase";

import { broadcast } from "@/lib/server/market-event-bus";

export const dynamic = "force-dynamic";

function headersFrom(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  const auth = request.headers.get("authorization");
  if (auth) headers.authorization = auth;
  const key = request.headers.get("x-api-key") || process.env.PROXY_API_KEY;
  if (key) headers["x-api-key"] = key;
  return headers;
}

function toIso(value: unknown): string {
  const n = Number(value);
  if (Number.isFinite(n)) return new Date(n * 1000).toISOString();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || "SPY").toUpperCase();
  const interval = request.nextUrl.searchParams.get("interval") || "1m";

  try {
    const response = await fetch(
      `${API_BASE}/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(interval)}`,
      {
        headers: headersFrom(request),
        cache: "no-store",
      }
    );

    const payload = (await response.json()) as { candles?: Array<Record<string, unknown>> };
    const rows = (payload.candles || []).map((row) => ({
      time: toIso(row.time),
      open: Number(row.open || row.close || 0),
      high: Number(row.high || row.close || 0),
      low: Number(row.low || row.close || 0),
      close: Number(row.close || 0),
      volume: Number(row.volume || 0),
    }));

    const latest = rows[rows.length - 1];
    if (latest) {
      const change = latest.open ? ((latest.close - latest.open) / latest.open) * 100 : 0;
      broadcast({
        type: "quote",
        symbol,
        price: latest.close,
        change,
        volume: latest.volume,
        interval,
        timestamp: Date.now(),
      });
    }

    return NextResponse.json(
      {
        status: response.ok ? "ok" : "error",
        data: rows,
      },
      { status: response.ok ? 200 : response.status }
    );
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { status: "error", message: "internal_error" },
      { status: 500 }
    );
  }
}
