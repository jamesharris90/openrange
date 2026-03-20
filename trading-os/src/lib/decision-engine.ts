import { toNumber } from "@/lib/number";

export type StockDecision = {
  reason: string;
  expectedMove: number;
  probability: number;
  confidence: number;
  catalystType: string;
};

type DecisionInput = {
  price?: unknown;
  lastPrice?: unknown;
  prevClose?: unknown;
  iv?: unknown;
  catalyst?: unknown;
  trend?: unknown;
  volumeSpike?: unknown;
  symbol?: unknown;
};

export function buildStockDecision(data: DecisionInput): StockDecision | null {
  const candidatePrices = [data.price, data.lastPrice, data.prevClose]
    .map((value) => {
      const parsed = toNumber(value, Number.NaN);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
    })
    .filter(Number.isFinite);
  const price = candidatePrices.length > 0 ? candidatePrices[0] : Number.NaN;

  const ivParsed = toNumber(data.iv, Number.NaN);
  const iv = Number.isFinite(ivParsed) && ivParsed > 0 ? ivParsed : Number.NaN;
  const symbol = String(data.symbol || "UNKNOWN").toUpperCase();

  const missing: string[] = [];
  if (!Number.isFinite(price) || price <= 0) missing.push("price");
  if (!Number.isFinite(iv) || iv <= 0) missing.push("iv");
  if (missing.length > 0) {
    console.warn("[DATA QUALITY ISSUE]", { symbol, missing });
    return null;
  }

  const catalyst = String(data.catalyst || "unknown").toLowerCase();
  const trend = String(data.trend || "neutral").toLowerCase();
  const hasVolumeSpike = Boolean(data.volumeSpike);

  const expectedMove = price * iv;

  let probability = 50;
  let confidence = 50;
  let reason = "No dominant signal";

  if (catalyst === "earnings") {
    probability = 65;
    confidence = 70;
    reason = "Earnings event with elevated implied volatility";
  }

  if (hasVolumeSpike) {
    probability += 10;
    confidence += 5;
    reason = "Unusual volume detected";
  }

  if (trend === "bullish") {
    probability += 5;
    reason += ", trend support";
  }

  if (trend === "bearish") {
    probability = Math.max(0, probability - 7);
    confidence = Math.max(0, confidence - 3);
    reason += ", downside trend pressure";
  }

  return {
    reason,
    expectedMove,
    probability: Math.max(0, Math.min(100, probability)),
    confidence: Math.max(0, Math.min(100, confidence)),
    catalystType: catalyst,
  };
}
