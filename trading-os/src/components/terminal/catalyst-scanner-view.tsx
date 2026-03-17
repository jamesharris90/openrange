"use client";

import { useQuery } from "@tanstack/react-query";

import { CatalystFeed } from "@/components/terminal/catalyst-feed";
import { getCatalystSignals } from "@/lib/api/catalysts";
import { QUERY_POLICY } from "@/lib/queries/policy";

export function CatalystScannerView() {
  const { data = {} } = useQuery({
    queryKey: ["medium", "catalystScanner"],
    queryFn: getCatalystSignals,
    ...QUERY_POLICY.medium,
  });

  return <CatalystFeed grouped={data} />;
}
