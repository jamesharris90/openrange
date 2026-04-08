import { NextRequest, NextResponse } from "next/server";

import { backendGet } from "@/app/api/_lib/proxy";
import { toStrictEnvelope } from "@/app/api/_lib/tradeObject";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const proxied = await backendGet(request, "/api/intelligence/top-opportunities");
  const payload = await proxied.json().catch(() => ({}));
  const envelope = toStrictEnvelope(payload, "intelligence_top_opportunities");

  if (envelope.count === 0) {
    console.error("[api/intelligence/top-opportunities] no complete trade objects", {
      raw_count: envelope.raw_count,
      rejected_count: envelope.rejected_count,
    });
  }

  return NextResponse.json(envelope, { status: proxied.ok ? 200 : proxied.status });
}
