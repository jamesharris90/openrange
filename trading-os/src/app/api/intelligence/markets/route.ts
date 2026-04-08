import { NextRequest, NextResponse } from "next/server";
import { normalizeMarketQuotes } from "@/lib/api/normalize";
import { API_BASE } from "@/lib/apiBase";

export const dynamic = "force-dynamic";

async function resolveSymbolsFromOverview(headers: Record<string, string>) {
  const overviewRes = await fetch(`${API_BASE}/api/market/overview`, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(8000),
  });
  const overviewPayload = await overviewRes.json().catch(() => ({}));
  const indices = overviewPayload?.indices;
  if (!indices || typeof indices !== "object") {
    return [] as string[];
  }

  return Object.keys(indices)
    .map((item) => String(item || "").trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 25);
}

export async function GET(request: NextRequest) {
  const symbolsRaw = request.nextUrl.searchParams.get("symbols") || "";
  const requestedSymbols = Array.from(
    new Set(
      symbolsRaw
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 25)
    )
  );

  const headers: Record<string, string> = { Accept: "application/json" };
  const key = request.headers.get("x-api-key") || process.env.PROXY_API_KEY;
  if (key) headers["x-api-key"] = key;

  try {
    const symbols = requestedSymbols.length > 0 ? requestedSymbols : await resolveSymbolsFromOverview(headers);
    if (symbols.length === 0) {
      return NextResponse.json(
        { status: "error", error: "symbols_required", data: [] },
        { status: 400 }
      );
    }

    const target = `${API_BASE}/api/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`;
    console.log("PROXY CALL:", target);
    const res = await fetch(target, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(8000),
    });
    const payload = await res.json().catch(() => ({}));
    console.log("PROXY STATUS:", res.status);
    console.log("PROXY SAMPLE:", JSON.stringify(payload).slice(0, 500));

    if (!res.ok || payload?.success !== true) {
      return NextResponse.json(
        { status: "error", error: "market_fetch_failed", data: [] },
        { status: res.status || 502 }
      );
    }

    const responses = normalizeMarketQuotes(payload).map((row) => ({
      symbol: row.symbol,
      price: row.price,
      change: row.change,
      volume: row.volume,
      sector: row.sector || null,
      market_cap: Number.isFinite(Number(row.marketCap)) ? Number(row.marketCap) : null,
      source: row.source || "polygon",
    }));

    const vixRow = responses.find((item) => String(item.symbol || "").toUpperCase().includes("VIX"));
    const vix = Number(vixRow?.price);
    const regime = Number.isFinite(vix) ? (vix > 25 ? "Risk-Off" : vix < 17 ? "Risk-On" : "Neutral") : "Neutral";

    return NextResponse.json({
      status: "ok",
      data: responses,
      regime: {
        regime,
        vix,
        breadth: Number.NaN,
        put_call: Number.NaN,
      },
    });
  } catch {
    console.error("PROXY STATUS:", 502);
    console.error("PROXY SAMPLE:", JSON.stringify({ status: "error", error: "market_fetch_failed" }));
    return NextResponse.json(
      { status: "error", error: "market_fetch_failed", data: [] },
      { status: 502 }
    );
  }
}
