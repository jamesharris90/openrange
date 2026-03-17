import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/config/apiBase";

import { broadcast } from "@/lib/server/market-event-bus";

export const dynamic = "force-dynamic";

type QuoteMap = Record<string, { price?: number; open?: number; close?: number; volume?: number }>;

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function headersFrom(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  const auth = request.headers.get("authorization");
  if (auth) headers.authorization = auth;
  const key = request.headers.get("x-api-key") || process.env.PROXY_API_KEY;
  if (key) headers["x-api-key"] = key;
  return headers;
}

async function loadBatchQuotes(request: NextRequest, symbols: string[]) {
  const response = await fetch(`${API_BASE}/api/quotes-batch?symbols=${encodeURIComponent(symbols.join(","))}`, {
    headers: headersFrom(request),
    cache: "no-store",
  });

  const payload = (await response.json()) as { data?: QuoteMap };
  const map = payload.data || {};

  const rows = symbols.map((symbol) => {
    const quote = map[symbol] || {};
    const price = toNumber(quote.price, 0);
    const open = toNumber(quote.open ?? quote.close, price || 1);
    const changePercent = open > 0 ? ((price - open) / open) * 100 : 0;

    return {
      symbol,
      price,
      change_percent: Number(changePercent.toFixed(4)),
      volume_24h: toNumber(quote.volume, 0),
      relative_volume: 0,
      gap_percent: 0,
      sector: "",
      market_cap: 0,
    };
  });

  rows.forEach((row) => {
    broadcast({
      type: "quote",
      symbol: row.symbol,
      price: row.price,
      change: row.change_percent,
      volume: row.volume_24h,
      timestamp: Date.now(),
    });
  });

  return NextResponse.json(
    {
      status: response.ok ? "ok" : "error",
      data: { rows },
    },
    { status: response.ok ? 200 : response.status }
  );
}

async function loadMarketSummary(request: NextRequest) {
  const response = await fetch(`${API_BASE}/api/radar/summary`, {
    headers: headersFrom(request),
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    market_context?: Record<string, unknown>;
    index_cards?: Array<Record<string, unknown>>;
  };

  const rows = (payload.index_cards || []).map((row) => ({
    symbol: String(row.symbol || "").toUpperCase(),
    price: toNumber(row.price, 0),
    change_percent: toNumber(row.change_percent, 0),
    volume_24h: toNumber(row.volume, 0),
    relative_volume: toNumber(row.relative_volume, 0),
    gap_percent: toNumber(row.gap_percent, 0),
    sector: String(row.sector || ""),
    market_cap: toNumber(row.market_cap, 0),
  }));

  rows.slice(0, 20).forEach((row) => {
    broadcast({
      type: "quote",
      symbol: row.symbol,
      price: row.price,
      change: row.change_percent,
      volume: row.volume_24h,
      timestamp: Date.now(),
    });
  });

  return NextResponse.json(
    {
      status: response.ok ? "ok" : "error",
      data: {
        rows,
        regime: payload.market_context || {},
      },
    },
    { status: response.ok ? 200 : response.status }
  );
}

export async function GET(request: NextRequest) {
  const symbolsRaw = request.nextUrl.searchParams.get("symbols") || "";
  const symbols = symbolsRaw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 25);

  try {
    if (symbols.length > 0) {
      return await loadBatchQuotes(request, symbols);
    }

    return await loadMarketSummary(request);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { status: "error", message: "internal_error" },
      { status: 500 }
    );
  }
}
