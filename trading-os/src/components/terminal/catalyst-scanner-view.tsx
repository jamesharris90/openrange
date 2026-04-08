"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { CatalystFeed } from "@/components/terminal/catalyst-feed";
import { getCatalystSignals } from "@/lib/api/catalysts";
import { QUERY_POLICY } from "@/lib/queries/policy";

export function CatalystScannerView() {
  const { data = {} } = useQuery({
    queryKey: ["medium", "catalystScanner"],
    queryFn: getCatalystSignals,
    ...QUERY_POLICY.medium,
  });

  useEffect(() => {
    const categories = Object.keys(data || {});
    console.log("CATALYST SCANNER RENDER", {
      categories,
      counts: categories.reduce<Record<string, number>>((acc, key) => {
        acc[key] = Array.isArray(data[key]) ? data[key].length : 0;
        return acc;
      }, {}),
    });
  }, [data]);

  const normalized = {
    catalysts: Array.isArray(data.catalysts) ? data.catalysts : [],
    earnings: Array.isArray(data.earnings) ? data.earnings : [],
    news: Array.isArray(data.news) ? data.news : [],
  };

  const totalRows = Object.values(normalized).reduce((sum, rows) => sum + rows.length, 0);
  if (totalRows === 0) {
    normalized.news = [
      {
        symbol: "",
        strategy: "Catalyst scanner connected. Waiting for fresh events.",
        probability: 0,
        confidence: 0,
        expected_move: 0,
        catalyst: "SYSTEM",
      },
    ];
  }

  return <CatalystFeed grouped={normalized} />;
}
