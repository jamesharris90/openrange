import { NextRequest, NextResponse } from "next/server";

import { backendGet } from "@/app/api/_lib/proxy";
import { toStrictEnvelope } from "@/app/api/_lib/tradeObject";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const proxied = await backendGet(request, "/api/intelligence/top-opportunities");
  const payload = await proxied.json().catch(() => ({}));
  let envelope = toStrictEnvelope(payload, "trading_terminal");

  if (envelope.count < 10) {
    const fallback = await backendGet(request, "/api/stocks-in-play");
    const fallbackPayload = await fallback.json().catch(() => ({}));
    const fallbackEnvelope = toStrictEnvelope(fallbackPayload, "trading_terminal_fallback");
    const merged = [...envelope.data, ...fallbackEnvelope.data];
    const deduped = Array.from(new Map(merged.map((row) => [row.symbol, row])).values());
    envelope = {
      ...envelope,
      data: deduped.slice(0, 20),
      count: deduped.slice(0, 20).length,
      source: fallbackEnvelope.count > 0 ? "trading_terminal+fallback" : envelope.source,
    };
  }

  if (envelope.count === 0) {
    console.error("[api/trading-terminal] no complete trade objects", {
      raw_count: envelope.raw_count,
      rejected_count: envelope.rejected_count,
    });
  }

  return NextResponse.json(envelope, { status: proxied.ok ? 200 : proxied.status });
}
