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

export async function GET(request: NextRequest, context: RouteContext) {
  return backendRequest(request, toApiPath(context.params.path), "GET");
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