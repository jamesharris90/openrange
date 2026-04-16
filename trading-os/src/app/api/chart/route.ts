import { NextRequest, NextResponse } from "next/server";

import { API_BASE } from "@/lib/apiBase";

export const dynamic = "force-dynamic";

function buildHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const auth = request.headers.get("authorization");
  if (auth) {
    headers.authorization = auth;
  }

  const incomingApiKey = request.headers.get("x-api-key");
  const apiKey = incomingApiKey || process.env.PROXY_API_KEY;
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  return headers;
}

function buildTarget(symbol: string, timeframe: string) {
  if (timeframe === "daily") {
    return `/api/v2/chart/${encodeURIComponent(symbol)}?interval=1day`;
  }

  return `/api/v5/chart?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`;
}

function toChartData(payload: unknown) {
  const rows = Array.isArray((payload as { candles?: unknown[] })?.candles)
    ? (payload as { candles: Array<Record<string, unknown>> }).candles
    : Array.isArray((payload as { data?: unknown[] })?.data)
      ? (payload as { data: Array<Record<string, unknown>> }).data
      : [];

  return rows
    .map((row) => {
      const time = Number(row.time ?? row.timestamp ?? row.date);
      const close = Number(row.close);
      const open = Number(row.open ?? close);
      const high = Number(row.high ?? close);
      const low = Number(row.low ?? close);
      const volume = Number(row.volume ?? 0);

      if (!Number.isFinite(time) || !Number.isFinite(close)) {
        return null;
      }

      return {
        time,
        open: Number.isFinite(open) ? open : close,
        high: Number.isFinite(high) ? high : close,
        low: Number.isFinite(low) ? low : close,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      };
    })
    .filter((row): row is { time: number; open: number; high: number; low: number; close: number; volume: number } => Boolean(row));
}

export async function GET(request: NextRequest) {
  const symbol = String(request.nextUrl.searchParams.get("symbol") || "").trim().toUpperCase();
  const timeframe = String(request.nextUrl.searchParams.get("timeframe") || "daily").trim();

  if (!symbol) {
    return NextResponse.json({ success: false, error: "symbol_required", data: [] }, { status: 400 });
  }

  const targetPath = buildTarget(symbol, timeframe);
  const targetUrl = `${API_BASE}${targetPath}`;

  console.log("PROXY CALL:", targetUrl);

  try {
    const timeoutMs = timeframe === "daily" ? 45000 : 20000;
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: buildHeaders(request),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => null);

    console.log("PROXY STATUS:", response.status);
    console.log("PROXY SAMPLE:", JSON.stringify(payload).slice(0, 500));

    if (!response.ok) {
      return NextResponse.json(payload || { success: false, error: "chart_fetch_failed", data: [] }, { status: response.status });
    }

    const data = toChartData(payload);
    return NextResponse.json({
      success: true,
      data,
      meta: {
        symbol,
        timeframe,
        count: data.length,
      },
    });
  } catch (error) {
    console.error("PROXY STATUS:", 502);
    console.error("PROXY SAMPLE:", JSON.stringify({ success: false, error: "BACKEND_UNREACHABLE" }));
    return NextResponse.json(
      { success: false, error: "BACKEND_UNREACHABLE", detail: error instanceof Error ? error.message : "unknown error", data: [] },
      { status: 502 }
    );
  }
}