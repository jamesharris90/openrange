import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/config/apiBase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || "SPY").toUpperCase();
  const url = `${API_BASE}/api/market/ohlc?symbol=${encodeURIComponent(symbol)}&interval=1d`;
  console.log("MARKET PROXY CALL:", url);

  try {
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      console.error("MARKET FETCH FAILED:", res.status);
      return NextResponse.json(
        { success: false, error: "market_fetch_failed" },
        { status: 200 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("MARKET FETCH FAILED:", error);
    return NextResponse.json(
      { success: false, error: "market_fetch_failed" },
      { status: 200 }
    );
  }
}
