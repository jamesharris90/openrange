import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/config/apiBase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || "SPY").toUpperCase();
  const interval = request.nextUrl.searchParams.get("interval") || "1m";
  const url = `${API_BASE}/api/market/ohlc?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`;
  console.log("PROXY CALL:", url);

  const headers: Record<string, string> = { Accept: "application/json" };
  const key = request.headers.get("x-api-key") || process.env.PROXY_API_KEY;
  if (key) headers["x-api-key"] = key;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(8000),
    });
    console.log("PROXY STATUS:", res.status);

    if (!res.ok) {
      return NextResponse.json(
        { status: "error", error: "market_fetch_failed", data: [] },
        { status: res.status }
      );
    }

    const data = await res.json();
    console.log("PROXY SAMPLE:", JSON.stringify(data).slice(0, 500));
    return NextResponse.json(data);
  } catch {
    console.error("PROXY STATUS:", 502);
    console.error("PROXY SAMPLE:", JSON.stringify({ status: "error", error: "market_fetch_failed" }));
    return NextResponse.json(
      { status: "error", error: "market_fetch_failed", data: [] },
      { status: 502 }
    );
  }
}
