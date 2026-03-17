import type { Metadata } from "next";

import { MarketsView } from "@/components/terminal/markets-view";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(
  "Markets | OpenRange Terminal",
  "Macro market charts for SPY, QQQ, IWM, and VIX with trend comparison.",
  "/markets"
);

export default function MarketsPage() {
  return <MarketsView />;
}
