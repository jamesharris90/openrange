import { CanonicalBase } from "./CanonicalTypes";

export interface CanonicalQuote extends CanonicalBase {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;

  avgVolume: number | null;
  rvol: number | null;
  rvolConfidence?: "HIGH" | "MEDIUM" | "LOW";
  marketCap: number | null;
  float: number | null;
  gapPercent: number | null;
  premarketVolume: number | null;

  timestamp: string;
  source: "FMP" | "COMPOSITE";
}
