"use client";

import { useQuery } from "@tanstack/react-query";

import { Sparkline } from "@/components/terminal/sparkline";
import { getAlerts } from "@/lib/api/alerts";
import { percentSafe, toNumber } from "@/lib/number";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";

export function AlertsView() {
  const { data = [] } = useQuery({
    queryKey: queryKeys.alerts,
    queryFn: getAlerts,
    ...QUERY_POLICY.medium,
  });

  const safeData = data.map((row) => ({
    ...row,
    value: toNumber((row as unknown as { value?: unknown }).value, 0),
    probability: toNumber(row.probability, 0),
    confidence: toNumber(row.confidence, 0),
  }));

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-3 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Alerts</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {safeData.map((row) => (
          <article key={row.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-sm text-slate-100">{row.symbol}</div>
                <div className="text-[11px] text-slate-400">{row.signal}</div>
              </div>
              <div className="text-right text-[11px] text-slate-400">{row.timestamp}</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1">
                <div className="text-[10px] uppercase text-slate-500">Probability</div>
                <div className="text-sm text-slate-100">{percentSafe(row.probability, 0)}</div>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1">
                <div className="text-[10px] uppercase text-slate-500">Confidence</div>
                <div className="text-sm text-slate-100">{percentSafe(row.confidence, 0)}</div>
              </div>
            </div>
            <div className="mt-3">
              <Sparkline values={row.sparkline || []} width={210} height={36} />
            </div>
          </article>
        ))}
        {safeData.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
            Alert stream connected. Cards will populate as qualifying signals arrive.
          </div>
        ) : null}
      </div>
    </div>
  );
}
