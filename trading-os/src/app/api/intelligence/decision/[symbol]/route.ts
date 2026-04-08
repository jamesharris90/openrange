import { NextRequest } from "next/server";

import { backendGet } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { symbol: string } }) {
  const symbol = encodeURIComponent(String(params.symbol || "").toUpperCase());
  return backendGet(request, `/api/intelligence/decision/${symbol}`);
}
