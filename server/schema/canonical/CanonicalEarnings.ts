import { CanonicalBase } from "./CanonicalTypes";

export interface CanonicalEarnings extends CanonicalBase {
  symbol: string;

  earningsDate: string; // ISO UTC
  eps?: number;
  revenue?: number;

  surprise?: number;
  guidance?: "raised" | "lowered" | "inline" | "unknown";
}
