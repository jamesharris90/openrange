import { NextRequest } from "next/server";

import { backendRequest } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    path: string[];
  };
};

function toApiPath(path: string[] = []): string {
  return `/api/${path.join("/")}`;
}

function timeoutForPath(path: string) {
  if (path.startsWith("/api/v2/research/")) {
    return 30000;
  }

  if (path === "/api/market/overview") {
    return 15000;
  }

  return undefined;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const path = toApiPath(context.params.path);
  return backendRequest(request, path, "GET", { timeoutMs: timeoutForPath(path) });
}

export async function POST(request: NextRequest, context: RouteContext) {
  return backendRequest(request, toApiPath(context.params.path), "POST");
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return backendRequest(request, toApiPath(context.params.path), "PUT");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return backendRequest(request, toApiPath(context.params.path), "PATCH");
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return backendRequest(request, toApiPath(context.params.path), "DELETE");
}