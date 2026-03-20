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
  try {
    const query = request.nextUrl.searchParams.toString();
    const path = query ? `/api/earnings?${query}` : "/api/earnings";

    const response = await fetch(`${API_BASE}${path}`, {
      headers: headersFrom(request),
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      {
        status: "error",
        message: "internal_error",
        source: "none",
      },
      { status: 500 }
    );
  }
}
