"use client";

import { useQuery } from "@tanstack/react-query";

import { Sparkline } from "@/components/terminal/sparkline";
import { getAlerts } from "@/lib/api/alerts";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";

export function AlertsView() {
  const { data = [] } = useQuery({
    queryKey: queryKeys.alerts,
    queryFn: getAlerts,
    ...QUERY_POLICY.medium,
  });

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-3 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Alerts</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="px-2 py-2">Timestamp</th>
              <th className="px-2 py-2">Symbol</th>
              <th className="px-2 py-2">Signal</th>
              <th className="px-2 py-2">Probability</th>
              <th className="px-2 py-2">Confidence</th>
              <th className="px-2 py-2">Sparkline</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.id} className="border-t border-slate-800 text-slate-300">
                <td className="px-2 py-2">{row.timestamp}</td>
                <td className="px-2 py-2 font-mono">{row.symbol}</td>
                <td className="px-2 py-2">{row.signal}</td>
                <td className="px-2 py-2">{row.probability.toFixed(0)}%</td>
                <td className="px-2 py-2">{row.confidence.toFixed(0)}%</td>
                <td className="px-2 py-2">
                  <Sparkline values={row.sparkline || []} width={90} height={24} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
