import type { Metadata } from "next";

import { EarningsView } from "@/components/terminal/earnings-view";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(
  "Earnings | OpenRange",
  "Earnings intelligence calendar with expected vs actual move, beat or miss, and revisions context.",
  "/earnings"
);

export default function EarningsPage() {
  return <EarningsView />;
}
