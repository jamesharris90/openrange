import { NextRequest } from "next/server";

import { backendGet } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { symbol: string } }) {
  const symbol = encodeURIComponent(params.symbol || "");
  return backendGet(request, `/api/catalysts/symbol/${symbol}`);
}
