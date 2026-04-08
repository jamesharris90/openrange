import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/apiBase";

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

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${API_BASE}/api/intelligence/catalysts`, {
      headers: headersFrom(request),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));

    const items = Array.isArray((payload as { items?: unknown[] }).items)
      ? ((payload as { items?: Array<Record<string, unknown>> }).items || [])
      : [];

    items.slice(0, 20).forEach((item) => {
      broadcast({
        type: "catalyst",
        symbol: String(item.symbol || "").toUpperCase(),
        catalyst: String(item.catalyst_type || item.headline || "Catalyst"),
        impact: Number(item.impact_score || 0),
        timestamp: Date.now(),
      });
    });

    return NextResponse.json(
      {
        status: response.ok ? "ok" : "error",
        data: payload,
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
