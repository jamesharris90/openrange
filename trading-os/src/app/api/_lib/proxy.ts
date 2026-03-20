import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/config/apiBase";

function buildHeaders(request: NextRequest, includeJson = false): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }

  const auth = request.headers.get("authorization");
  if (auth) headers.authorization = auth;

  const incomingApiKey = request.headers.get("x-api-key");
  const apiKey = incomingApiKey || process.env.PROXY_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;

  return headers;
}

function withQuery(path: string, request: NextRequest): string {
  const query = request.nextUrl.searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export async function backendGet(request: NextRequest, path: string): Promise<NextResponse> {
  const target = `${API_BASE}${withQuery(path, request)}`;
  console.log("PROXY CALL:", target);
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: buildHeaders(request),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    console.log("PROXY STATUS:", response.status);
    console.log("PROXY SAMPLE:", JSON.stringify(payload).slice(0, 500));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("PROXY STATUS:", 502);
    console.error("PROXY SAMPLE:", JSON.stringify({ success: false, error: "BACKEND_UNREACHABLE" }));
    return NextResponse.json(
      { success: false, error: "BACKEND_UNREACHABLE", detail: error instanceof Error ? error.message : "unknown error" },
      { status: 502 }
    );
  }
}

export async function backendPost(request: NextRequest, path: string): Promise<NextResponse> {
  const target = `${API_BASE}${path}`;
  console.log("PROXY CALL:", target);
  try {
    const body = await request.json().catch(() => ({}));

    const response = await fetch(target, {
      method: "POST",
      headers: buildHeaders(request, true),
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    console.log("PROXY STATUS:", response.status);
    console.log("PROXY SAMPLE:", JSON.stringify(payload).slice(0, 500));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("PROXY STATUS:", 502);
    console.error("PROXY SAMPLE:", JSON.stringify({ success: false, error: "BACKEND_UNREACHABLE" }));
    return NextResponse.json(
      { success: false, error: "BACKEND_UNREACHABLE", detail: error instanceof Error ? error.message : "unknown error" },
      { status: 502 }
    );
  }
}
