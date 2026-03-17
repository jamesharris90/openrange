import type { Metadata } from "next";

import { AlertsView } from "@/components/terminal/alerts-view";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(
  "Alerts | OpenRange",
  "Dense terminal view of timestamped signal alerts with probability and confidence context.",
  "/alerts"
);

export default function AlertsPage() {
  return <AlertsView />;
}
