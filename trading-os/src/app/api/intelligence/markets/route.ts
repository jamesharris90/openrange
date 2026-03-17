import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/config/apiBase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbolsRaw = request.nextUrl.searchParams.get("symbols") || "";
  const symbols = symbolsRaw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 25);
  const url = symbols.length
    ? `${API_BASE}/api/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`
    : `${API_BASE}/api/market/quotes`;
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
