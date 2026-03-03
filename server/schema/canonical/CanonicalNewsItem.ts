import { CanonicalBase } from "./CanonicalTypes";

export interface CanonicalNewsItem extends CanonicalBase {
  id: string;
  headline: string;
  summary?: string;
  source: string;
  publishedAt: string; // ISO UTC
  url?: string;

  tickers: string[];

  sentimentScore?: number; // -1 to 1
  categoryTags?: string[];
}
