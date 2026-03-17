"use client";

import { useQuery } from "@tanstack/react-query";

import { ConfidenceMeter } from "@/components/confidence-meter";
import { ProbabilityBar } from "@/components/probability-bar";
import { TradingChart } from "@/components/trading-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getInstitutionalFlowCandidates } from "@/lib/queries";
import { formatPct } from "@/lib/utils";

export function StockDeepDive({ ticker }: { ticker: string }) {
  const { data } = useQuery({
    queryKey: ["institutional-flow", ticker],
    queryFn: getInstitutionalFlowCandidates,
  });

  const selected =
    data?.find((row) => row.ticker.toUpperCase() === ticker.toUpperCase()) ?? data?.[0];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="font-mono text-cyan-200">{ticker.toUpperCase()}</span>
            {selected ? (
              <span className={selected.change_pct >= 0 ? "text-bull" : "text-bear"}>
                {formatPct(selected.change_pct)}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TradingChart ticker={ticker} />
        </CardContent>
      </Card>

      {selected ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Setup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Badge variant="accent">{selected.setup}</Badge>
              <p className="text-sm text-muted-foreground">
                Volume ratio at {selected.volume_ratio.toFixed(1)}x indicates sustained tape interest.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Model Confidence</CardTitle>
            </CardHeader>
            <CardContent>
              <ConfidenceMeter value={selected.confidence} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Success Probability</CardTitle>
            </CardHeader>
            <CardContent>
              <ProbabilityBar value={selected.probability} />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
