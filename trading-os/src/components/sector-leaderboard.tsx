"use client";

import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSectorMomentum } from "@/lib/queries";
import { formatPct } from "@/lib/utils";

export function SectorLeaderboard() {
  const { data } = useQuery({
    queryKey: ["sector-momentum"],
    queryFn: getSectorMomentum,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sector Momentum</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data?.map((item) => (
          <div
            key={item.sector}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded border border-border bg-background px-3 py-2"
          >
            <p className="text-sm">{item.sector}</p>
            <p className="font-mono text-xs text-muted-foreground">{item.score}</p>
            <p className={`font-mono text-xs ${item.change_pct >= 0 ? "text-bull" : "text-bear"}`}>
              {formatPct(item.change_pct)}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
