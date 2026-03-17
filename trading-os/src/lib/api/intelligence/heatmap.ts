import type { HeatmapRow } from "@/lib/types";

import { apiGet } from "@/lib/api/client";

export async function getHeatmapRows(): Promise<HeatmapRow[]> {
  const response = await apiGet<{ success?: boolean; data?: HeatmapRow[] }>("/api/intelligence/heatmap");
  if (response.success !== true) {
    throw new Error("Intelligence heatmap request failed");
  }

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid heatmap response contract");
  }

  return response.data;
}
