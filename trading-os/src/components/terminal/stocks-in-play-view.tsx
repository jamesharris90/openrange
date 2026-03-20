"use client";

import { DataState } from "@/components/system/data-state";
import { OpportunityCard } from "@/components/terminal/opportunity-card";
import { ExpectedMoveChip } from "@/components/terminal/expected-move-chip";
import { percentSafe, toFixedSafe, toNumber } from "@/lib/number";
import { useTopOpportunity } from "@/lib/hooks/useTopOpportunity";

export function StocksInPlayView() {
  const { data } = useTopOpportunity();
  const opportunity = data?.[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Leader</div>
          <div className="mt-1 font-mono text-lg text-slate-100">{opportunity?.symbol || ""}</div>
          <div className="text-xs text-slate-400">{opportunity?.strategy || ""}</div>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Signal Quality</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">{toFixedSafe(toNumber(opportunity?.confidence, 0), 0)}%</div>
          <div className="text-xs text-slate-400">Confidence</div>
        </article>
        <ExpectedMoveChip
          label="Top Expected Move"
          percent={toNumber(opportunity?.expected_move_percent, Number.NaN)}
        />
      </div>

      {opportunity ? (
        <div className="rounded-2xl border border-slate-800 bg-panel p-3 text-xs text-slate-300 shadow-lg">
          <span className="font-mono text-slate-100">{opportunity.symbol}</span> strategy {String(opportunity.strategy || "")},
          confidence {toFixedSafe(toNumber(opportunity.confidence, Number.NaN), 0)}%, expected move {percentSafe(toNumber(opportunity.expected_move_percent, Number.NaN), 2)}.
        </div>
      ) : null}

      <DataState data={opportunity} emptyMessage="No active setup">
        {opportunity ? <OpportunityCard data={opportunity} /> : null}
      </DataState>
    </div>
  );
}
