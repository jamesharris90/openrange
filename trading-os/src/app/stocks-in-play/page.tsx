import type { Metadata } from "next";

import { StocksInPlayView } from "@/components/terminal/stocks-in-play-view";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(
  "Stocks In Play | OpenRange Terminal",
  "Advanced virtualized screener for setup probability, confidence, and expected move.",
  "/stocks-in-play"
);

export default function StocksInPlayPage() {
  return <StocksInPlayView />;
}
