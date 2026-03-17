"use client";

import { TableVirtuoso } from "react-virtuoso";
import { useMemo } from "react";

import { useTickerStore } from "@/lib/store/ticker-store";
import type { Opportunity } from "@/lib/types";

export function SignalTable({ rows }: { rows: Opportunity[] }) {
  const liveSignals = useTickerStore((state) => state.signals);

  const mergedRows = useMemo(() => {
    if (liveSignals.length === 0) return rows;

    const seen = new Set<string>();
    const next: Opportunity[] = [];

    for (const row of [...liveSignals, ...rows]) {
      const key = `${row.symbol}-${row.strategy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(row);
    }

    return next;
  }, [liveSignals, rows]);

  return (
    <div className="h-[460px] rounded-2xl border border-slate-800 bg-panel shadow-lg">
      <TableVirtuoso
        data={mergedRows}
        fixedHeaderContent={() => (
          <tr className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2 text-left">Symbol</th>
            <th className="px-3 py-2 text-left">Strategy</th>
            <th className="px-3 py-2 text-left">Probability</th>
            <th className="px-3 py-2 text-left">Confidence</th>
            <th className="px-3 py-2 text-left">Expected Move</th>
          </tr>
        )}
        itemContent={(_, row) => (
          <>
            <td className="border-t border-slate-800 px-3 py-2 font-mono text-xs text-slate-100">{row.symbol}</td>
            <td className="border-t border-slate-800 px-3 py-2 text-xs text-slate-300">{row.strategy}</td>
            <td className="border-t border-slate-800 px-3 py-2 text-xs text-slate-300">{row.probability.toFixed(0)}%</td>
            <td className="border-t border-slate-800 px-3 py-2 text-xs text-slate-300">{row.confidence.toFixed(0)}%</td>
            <td className="border-t border-slate-800 px-3 py-2 text-xs text-slate-300">{row.expected_move.toFixed(2)}%</td>
          </>
        )}
      />
    </div>
  );
}
