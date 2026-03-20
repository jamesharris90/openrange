"use client";

import { TableVirtuoso } from "react-virtuoso";
import { useMemo } from "react";

import { percentSafe, toNumber } from "@/lib/number";
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

  const safeRows = mergedRows.map((row) => ({
    ...row,
    value: toNumber((row as unknown as { value?: unknown }).value, 0),
    probability: toNumber(row.probability, 0),
    confidence: toNumber(row.confidence, 0),
    expected_move: toNumber(row.expected_move, 0),
  }));

  return (
    <div className="h-[460px] rounded-2xl border border-slate-800 bg-panel shadow-lg">
      <TableVirtuoso
        data={safeRows}
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
          (() => {
            const probability = toNumber(row.probability, 0);
            const confidence = toNumber(row.confidence, 0);
            const expectedMove = toNumber(row.expected_move, 0);
            const strategy = String(row.strategy || (row as unknown as { setup?: string }).setup || "N/A");
            return (
          <>
            <td className="border-t border-slate-800 px-3 py-2 font-mono text-xs text-slate-100">{row.symbol}</td>
            <td className="border-t border-slate-800 px-3 py-2 text-xs text-slate-300">{strategy}</td>
            <td className="border-t border-slate-800 px-3 py-2 text-xs text-slate-300">{percentSafe(probability, 0)}</td>
            <td className="border-t border-slate-800 px-3 py-2 text-xs text-slate-300">{percentSafe(confidence, 0)}</td>
            <td className="border-t border-slate-800 px-3 py-2 text-xs text-slate-300">{percentSafe(expectedMove, 2)}</td>
          </>
            );
          })()
        )}
      />
    </div>
  );
}
