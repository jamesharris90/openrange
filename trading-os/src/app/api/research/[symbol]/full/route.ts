import { NextRequest } from "next/server";

import { backendGet } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    symbol: string;
  };
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const symbol = encodeURIComponent(String(params.symbol || "").toUpperCase());
  return backendGet(request, `/api/research/${symbol}/full`);
}