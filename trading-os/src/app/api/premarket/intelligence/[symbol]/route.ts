import { NextRequest } from "next/server";
import { backendGet } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  return backendGet(request, `/api/premarket/intelligence/${params.symbol}`);
}
