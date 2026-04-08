import { backendGet } from "@/app/api/_lib/proxy";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return backendGet(request, "/api/ohlc/intraday");
}
