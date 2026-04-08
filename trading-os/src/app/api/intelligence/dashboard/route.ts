import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/apiBase";

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
    const target = `${API_BASE}/api/intelligence/summary`;
    console.log("PROXY CALL:", target);
    const response = await fetch(target, {
      headers: headersFrom(request),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json().catch(() => ({}));
    console.log("PROXY STATUS:", response.status);
    console.log("PROXY SAMPLE:", JSON.stringify(payload).slice(0, 500));

    return NextResponse.json(
      {
        status: response.ok ? "ok" : "error",
        data: payload,
      },
      { status: response.ok ? 200 : response.status }
    );
  } catch {
    console.error("PROXY STATUS:", 502);
    console.error("PROXY SAMPLE:", JSON.stringify({ status: "error", message: "backend_unreachable" }));
    return NextResponse.json(
      {
        status: "error",
        message: "backend_unreachable",
        data: {},
      },
      { status: 502 }
    );
  }
}
