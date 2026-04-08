import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "@/lib/apiBase";
import { backendPost } from "@/app/api/_lib/proxy";

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
  const endpoints = [
    "/api/system/health",
    "/api/metrics/health",
    "/api/ingestion/health",
    "/api/universe/health",
    "/api/queue/health",
    "/api/admin/email-status",
  ];

  try {
    const results = await Promise.allSettled(
      endpoints.map(async (path) => {
        const response = await fetch(`${API_BASE}${path}`, {
          headers: headersFrom(request),
          cache: "no-store",
        });

        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        return {
          path,
          ok: response.ok,
          status: response.status,
          payload,
        };
      })
    );

    const checks = results.map((result, index) => {
      const path = endpoints[index] || "unknown";
      if (result.status === "fulfilled") {
        return {
          name: path.replace("/api/", ""),
          status: result.value.ok ? "ok" : "error",
          detail: result.value.ok ? "healthy" : `http_${result.value.status}`,
          payload: result.value.payload,
        };
      }

      return {
        name: path.replace("/api/", ""),
        status: "error",
        detail: result.reason instanceof Error ? result.reason.message : "unreachable",
        payload: null,
      };
    });

    const emailStatus = checks.find((item) => item.name === "admin/email-status")?.payload as
      | { data?: unknown }
      | undefined;

    const statusByName = Object.fromEntries(checks.map((item) => [item.name, item.status]));

    const payload = {
      system: "operational",
      database: statusByName["system/health"] === "ok" ? "connected" : "degraded",
      engines: statusByName["metrics/health"] === "ok" ? "running" : "degraded",
      ingestion: statusByName["ingestion/health"] === "ok" ? "active" : "degraded",
      queue: statusByName["queue/health"] === "ok" ? "healthy" : "degraded",
      timestamp: Date.now(),
      checks,
      email: emailStatus?.data || null,
    };

    return NextResponse.json({
      status: "ok",
      ...payload,
      data: payload,
    });
  } catch (error) {
    console.error("API error:", error);
    const payload = {
      system: "degraded",
      database: "degraded",
      engines: "degraded",
      ingestion: "degraded",
      queue: "degraded",
      timestamp: Date.now(),
      checks: [],
    };

    return NextResponse.json(
      {
        status: "error",
        ...payload,
        data: payload,
        message: "internal_error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const proxied = await backendPost(request, "/api/admin/email-test");
    const payload = await proxied.json().catch(() => null);

    return NextResponse.json(
      {
        status: proxied.ok ? "ok" : "error",
        data: payload,
      },
      { status: proxied.ok ? 200 : proxied.status }
    );
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      {
        status: "error",
        message: "internal_error",
      },
      { status: 500 }
    );
  }
}
