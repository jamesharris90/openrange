import { NextRequest, NextResponse } from "next/server";

import { backendGet } from "@/app/api/_lib/proxy";
import { toStrictEnvelope } from "@/app/api/_lib/tradeObject";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const proxied = await backendGet(request, "/api/stocks-in-play");
  const payload = await proxied.json().catch(() => ({}));
  let envelope = toStrictEnvelope(payload, "stocks_in_play");

  const sourceUnavailable =
    (payload && typeof payload === "object" && (payload as Record<string, unknown>).unavailable === true) ||
    (payload && typeof payload === "object" && (payload as Record<string, unknown>).success === false);

  if (sourceUnavailable || envelope.count === 0) {
    const fallback = await backendGet(request, "/api/intelligence/top-opportunities");
    const fallbackPayload = await fallback.json().catch(() => ({}));
    const fallbackEnvelope = toStrictEnvelope(fallbackPayload, "stocks_in_play_fallback_top_opportunities");
    if (fallbackEnvelope.count > 0) {
      console.warn("[api/stocks-in-play] fallback applied", {
        raw_count: envelope.raw_count,
        rejected_count: envelope.rejected_count,
        fallback_count: fallbackEnvelope.count,
      });
      envelope = fallbackEnvelope;
    }
  }

  if (envelope.count === 0) {
    console.error("[api/stocks-in-play] no complete trade objects", {
      raw_count: envelope.raw_count,
      rejected_count: envelope.rejected_count,
    });
  }

  return NextResponse.json(envelope, { status: proxied.ok ? 200 : proxied.status });
}
