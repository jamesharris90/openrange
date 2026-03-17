"use client";

import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMarketRegimeInputs } from "@/lib/queries";

export function MarketOverview() {
  const { data } = useQuery({
    queryKey: ["regime-inputs"],
    queryFn: getMarketRegimeInputs,
  });

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Overview</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-4">
        <Stat label="Regime" value={data.regime} />
        <Stat label="VIX" value={data.vix.toFixed(1)} mono />
        <Stat label="Breadth" value={`${Math.round(data.breadth * 100)}%`} mono />
        <Stat label="Put/Call" value={data.put_call.toFixed(2)} mono />
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
