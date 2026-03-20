import { toNumber } from "@/lib/number";

type MarketContextInput = {
  price?: unknown;
  lastPrice?: unknown;
  prevClose?: unknown;
  iv?: unknown;
  gex?: unknown;
  openInterest?: unknown;
  symbol?: unknown;
};

export function buildMarketContext(data: MarketContextInput) {
  const rawPrice =
    toNumber(data.price, 0) ||
    toNumber(data.lastPrice, 0) ||
    toNumber(data.prevClose, 0);
  const price = rawPrice;
  const iv = toNumber(data.iv, 0);
  const symbol = String(data.symbol || "UNKNOWN").toUpperCase();

  const missing: string[] = [];
  if (!price || price <= 0) missing.push("price");
  if (missing.length > 0) {
    console.warn("[DATA QUALITY ISSUE]", { symbol, missing });
    return null;
  }

  if (!iv || iv <= 0) {
    console.warn("[DATA QUALITY ISSUE]", { symbol, missing: ["iv"] });
  }

  const expectedMove = iv > 0 ? price * iv : Number.NaN;

  const gex = toNumber(data.gex, 0);
  const oi = toNumber(data.openInterest, 0);

  let positioning = "neutral";

  if (gex > 0) positioning = "supportive";
  if (gex < 0) positioning = "volatile";

  return {
    expectedMove,
    positioning,
    gex,
    oi,
  };
}
