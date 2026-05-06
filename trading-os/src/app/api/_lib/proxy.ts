import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/apiBase";

function buildHeaders(request: NextRequest, includeJson = false): Record<string, string> {
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

function responseHeaders(response: Response): HeadersInit {
  const contentType = response.headers.get("content-type");
  return contentType ? { "content-type": contentType } : {};
}

export async function backendRequest(
  request: NextRequest,
  path: string,
  method = request.method,
  options: { timeoutMs?: number } = {}
): Promise<NextResponse> {
  const target = `${API_BASE}${withQuery(path, request)}`;
  const timeoutMs = Number(options.timeoutMs) || 20000;
  const headers = buildHeaders(request);
  const init: RequestInit = {
    method,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (method !== "GET" && method !== "HEAD") {
    const body = await request.text();
    const contentType = request.headers.get("content-type");

    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    if (body) {
      init.body = body;
    }
  }

  console.log("PROXY CALL:", target);
  try {
    const response = await fetch(target, init);
    const payload = await response.text();
    console.log("PROXY STATUS:", response.status);
    console.log("PROXY SAMPLE:", payload.slice(0, 500));
    return new NextResponse(payload, {
      status: response.status,
      headers: responseHeaders(response),
    });
  } catch (error) {
    console.error("PROXY STATUS:", 502);
    console.error("PROXY SAMPLE:", JSON.stringify({ success: false, error: "BACKEND_UNREACHABLE" }));
    return NextResponse.json(
      { success: false, error: "BACKEND_UNREACHABLE", detail: error instanceof Error ? error.message : "unknown error" },
      { status: 502 }
    );
  }
}

export async function backendGet(
  request: NextRequest,
  path: string,
  options: { timeoutMs?: number } = {}
): Promise<NextResponse> {
  return backendRequest(request, path, "GET", options);
}

export async function backendPost(request: NextRequest, path: string): Promise<NextResponse> {
  return backendRequest(request, path, "POST");
}
