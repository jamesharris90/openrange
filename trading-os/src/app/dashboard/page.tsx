import type { Metadata } from "next";

import { DashboardView } from "@/components/terminal/dashboard-view";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(
  "Dashboard | OpenRange Terminal",
  "Market regime, breadth, sector momentum, opportunity stream, and alert intelligence.",
  "/dashboard"
);

export default function DashboardPage() {
  return <DashboardView />;
}
