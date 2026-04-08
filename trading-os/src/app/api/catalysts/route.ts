import { NextRequest, NextResponse } from "next/server";

import { backendGet } from "@/app/api/_lib/proxy";
import { toStrictEnvelope } from "@/app/api/_lib/tradeObject";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const proxied = await backendGet(request, "/api/catalysts");
  const payload = await proxied.json().catch(() => ({}));
  const envelope = toStrictEnvelope(payload, "catalysts");

  const now = Date.now();
  const freshData = envelope.data.filter((row) => {
    const ts = Date.parse(String(row.updated_at || ""));
    if (!Number.isFinite(ts)) return false;
    const ageMinutes = (now - ts) / 60000;
    return ageMinutes <= 15;
  });

  const freshEnvelope = {
    ...envelope,
    data: freshData,
    count: freshData.length,
    last_updated: freshData.reduce((latest, row) => {
      const rowTs = Date.parse(row.updated_at);
      const latestTs = Date.parse(latest);
      return Number.isFinite(rowTs) && rowTs > latestTs ? row.updated_at : latest;
    }, envelope.last_updated),
  };

  if (freshEnvelope.count < envelope.count) {
    console.warn("[api/catalysts] stale rows filtered", {
      before_count: envelope.count,
      after_count: freshEnvelope.count,
    });
  }

  const finalEnvelope = freshEnvelope.count > 0 ? freshEnvelope : envelope;

  if (finalEnvelope.count === 0) {
    console.error("[api/catalysts] no complete trade objects", {
      raw_count: envelope.raw_count,
      rejected_count: envelope.rejected_count,
    });
  }

  return NextResponse.json(finalEnvelope, { status: proxied.ok ? 200 : proxied.status });
}
