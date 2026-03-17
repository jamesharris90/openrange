"use client";

import type { Timeframe } from "@/lib/types";

const buckets = ["Strong Sell", "Sell", "Neutral", "Buy", "Strong Buy"] as const;

function gaugeLabel(score: number) {
  if (score <= 20) return buckets[0];
  if (score <= 40) return buckets[1];
  if (score <= 60) return buckets[2];
  if (score <= 80) return buckets[3];
  return buckets[4];
}

export function TechnicalGauge({
  score,
  timeframe,
  onTimeframeChange,
}: {
  score: number;
  timeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
}) {
  const normalized = Math.max(0, Math.min(100, score));
  const label = gaugeLabel(normalized);
  const color = normalized >= 60 ? "#16c784" : normalized >= 40 ? "#64748b" : "#ea3943";

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
      <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Technical Gauge</div>
      <div className="mb-3 h-2 w-full rounded-full bg-slate-800">
        <div className="h-2 rounded-full" style={{ width: `${normalized}%`, backgroundColor: color }} />
      </div>
      <div className="mb-3 text-sm font-semibold text-slate-100">{label}</div>
      <div className="flex flex-wrap gap-1">
        {(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"] as Timeframe[]).map((item) => (
          <button
            key={item}
            className={`rounded-md border px-2 py-1 text-[11px] ${item === timeframe ? "border-blue-400 bg-blue-500/20 text-blue-200" : "border-slate-700 text-slate-400"}`}
            onClick={() => onTimeframeChange(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
