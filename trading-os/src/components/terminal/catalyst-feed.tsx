"use client";

import Link from "next/link";
import { useMemo } from "react";

import { useTickerStore } from "@/lib/store/ticker-store";
import type { Opportunity } from "@/lib/types";

export function CatalystFeed({ grouped }: { grouped: Record<string, Opportunity[]> }) {
  const liveSignals = useTickerStore((state) => state.signals);
  const liveAlerts = useTickerStore((state) => state.alerts);

  const mergedGrouped = useMemo(() => {
    const liveCatalysts = liveSignals
      .filter((row) => /(catalyst|earn|news)/i.test(row.strategy))
      .slice(0, 20);

    const alertCatalysts = liveAlerts.slice(0, 20).map<Opportunity>((alert) => ({
      symbol: alert.symbol,
      strategy: alert.signal,
      probability: alert.probability,
      confidence: alert.confidence,
      expected_move: 0,
    }));

    const merged: Record<string, Opportunity[]> = {
      ...grouped,
      catalysts: [...liveCatalysts, ...alertCatalysts, ...(grouped.catalysts || [])],
    };

    for (const [category, rows] of Object.entries(merged)) {
      const seen = new Set<string>();
      merged[category] = rows.filter((row) => {
        const key = `${row.symbol}-${row.strategy}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return merged;
  }, [grouped, liveAlerts, liveSignals]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
      <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Catalyst Scanner</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(mergedGrouped).map(([category, rows]) => (
          <div key={category} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-400">{category}</div>
            <div className="space-y-2">
              {(rows || []).slice(0, 4).map((row) => (
                <div key={`${category}-${row.symbol}-${row.strategy}`} className="rounded-lg border border-slate-800 px-2 py-2 text-xs">
                  <div className="font-mono text-slate-100">{row.symbol}</div>
                  {row.news_id ? (
                    <Link className="text-slate-400 underline-offset-2 hover:underline" href={`/catalysts/${row.news_id}`}>
                      {row.strategy}
                    </Link>
                  ) : (
                    <div className="text-slate-400">{row.strategy}</div>
                  )}
                  <div className="text-slate-500">P {row.probability.toFixed(0)}% | C {row.confidence.toFixed(0)}%</div>
                </div>
              ))}
              {rows.length === 0 && <div className="text-xs text-slate-500">No active signals</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
