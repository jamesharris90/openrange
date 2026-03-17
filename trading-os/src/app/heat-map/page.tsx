import type { Metadata } from "next";

import { HeatMapView } from "@/components/terminal/heat-map-view";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(
  "Heat Map | OpenRange",
  "Sector and company treemap heat map with dynamic sizing metrics and momentum color encoding.",
  "/heat-map"
);

export default function HeatMapPage() {
  return <HeatMapView />;
}
