import type { Metadata } from "next";

import { DataHealthPanel } from "@/components/admin/data-health-panel";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(
  "Data Health | OpenRange",
  "Production-grade data integrity monitor for authoritative tables, pipelines, and frontend parity.",
  "/admin/data-health"
);

export default function DataHealthPage() {
  return <DataHealthPanel />;
}
