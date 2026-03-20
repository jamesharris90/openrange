import { NextRequest, NextResponse } from "next/server";

import { API_BASE } from "@/lib/config/apiBase";

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
  const target = `${API_BASE}/api/system/health`;
  console.log("PROXY CALL:", target);

  try {
    const response = await fetch(target, {
      headers: headersFrom(request),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    console.log("PROXY STATUS:", response.status);
    console.log("PROXY SAMPLE:", JSON.stringify(payload).slice(0, 500));

    const normalized = {
      backend: String(payload.backend || "unknown"),
      db: String(payload.db || payload.db_status || "unknown"),
      quotes: String(payload.quotes || "unknown"),
      ohlc: String(payload.ohlc || "unknown"),
      data: payload,
    };

    return NextResponse.json(normalized, { status: response.status });
  } catch (error) {
    console.error("PROXY STATUS:", 502);
    console.error("PROXY SAMPLE:", JSON.stringify({ backend: "unreachable", db: "unknown", quotes: "unknown", ohlc: "unknown" }));

    return NextResponse.json(
      {
        backend: "unreachable",
        db: "unknown",
        quotes: "unknown",
        ohlc: "unknown",
        error: error instanceof Error ? error.message : "backend_unreachable",
      },
      { status: 502 }
    );
  }
}
