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
  const target = `${API_BASE}/api/system/data-integrity`;
  console.log("PROXY CALL:", target);

  try {
    const response = await fetch(target, {
      headers: headersFrom(request),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });

    const payload = await response.json().catch(() => ({}));
    console.log("PROXY STATUS:", response.status);
    console.log("PROXY SAMPLE:", JSON.stringify(payload).slice(0, 500));

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("PROXY STATUS:", 502);
    console.error("PROXY SAMPLE:", JSON.stringify({ status: "down", error: "backend_unreachable" }));

    return NextResponse.json(
      {
        status: "down",
        checked_at: new Date().toISOString(),
        issues: [
          {
            severity: "critical",
            type: "proxy",
            key: "backend_unreachable",
            message: "Backend data-integrity endpoint unreachable",
            detail: error instanceof Error ? error.message : "unknown error",
          },
        ],
        pipelines: [],
      },
      { status: 502 }
    );
  }
}
