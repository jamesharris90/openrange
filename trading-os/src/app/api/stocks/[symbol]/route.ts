import { backendGet } from "@/app/api/_lib/proxy";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const upper = (symbol || "").toUpperCase().trim();
  return backendGet(request, `/api/stocks/${upper}`);
}
