"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getInstitutionalFlowCandidates } from "@/lib/queries";
import { formatPct } from "@/lib/utils";

export function SignalTable() {
  const { data } = useQuery({
    queryKey: ["institutional-flow"],
    queryFn: getInstitutionalFlowCandidates,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Institutional Flow Signals</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="pb-2">Ticker</th>
              <th className="pb-2">Setup</th>
              <th className="pb-2">Confidence</th>
              <th className="pb-2">Probability</th>
              <th className="pb-2">RVOL</th>
              <th className="pb-2">Move</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data?.map((row) => (
              <tr key={`${row.ticker}-${row.setup}`}>
                <td className="py-3 font-mono text-cyan-200">{row.ticker}</td>
                <td className="py-3">{row.setup}</td>
                <td className="py-3">
                  <Badge variant="accent">{row.confidence}%</Badge>
                </td>
                <td className="py-3 font-mono text-xs">{row.probability}%</td>
                <td className="py-3 font-mono text-xs">{row.volume_ratio.toFixed(1)}x</td>
                <td className={`py-3 font-mono text-xs ${row.change_pct >= 0 ? "text-bull" : "text-bear"}`}>
                  {formatPct(row.change_pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
