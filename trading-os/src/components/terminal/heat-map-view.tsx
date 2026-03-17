"use client";

import { useQuery } from "@tanstack/react-query";

import { SectorHeatMap } from "@/components/heatmap/sector-heatmap";
import { getHeatmapRows } from "@/lib/api/heatmap";
import { QUERY_POLICY } from "@/lib/queries/policy";

export function HeatMapView() {
  const { data = [] } = useQuery({
    queryKey: ["medium", "heatmapRows"],
    queryFn: getHeatmapRows,
    ...QUERY_POLICY.medium,
  });

  return <SectorHeatMap rows={data} />;
}
