import type { HeatmapRow } from "@/lib/types";

import { apiGet } from "@/lib/api/client";
import { adaptHeatmapPayload } from "@/lib/adapters";
import { debugLog } from "@/lib/debug";

export async function getHeatmapRows(): Promise<HeatmapRow[]> {
  try {
    const response = await apiGet<Record<string, unknown>>("/api/intelligence/heatmap");
    debugLog("/api/intelligence/heatmap", response);
    return adaptHeatmapPayload(response);
  } catch (error) {
    debugLog("heatmap error", error);
    return [];
  }
}
