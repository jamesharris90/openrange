"use client";

import { Badge } from "@/components/ui/badge";

function resolveLabel(score) {
  const numeric = Number(score || 0);
  if (numeric >= 85) return 'HIGH';
  if (numeric >= 65) return 'MEDIUM';
  if (numeric >= 40) return 'LOW';
  return 'POOR';
}

function resolveVariant(score) {
  const numeric = Number(score || 0);
  if (numeric >= 85) return 'success';
  if (numeric >= 65) return 'accent';
  if (numeric >= 40) return 'default';
  return 'danger';
}

function formatMetric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : '—';
}

export default function DataConfidenceBadge({
  score,
  label,
  coverageScore,
  freshnessScore,
  sourceQuality,
  hasNews,
}) {
  const numeric = Number(score || 0);
  const resolvedLabel = label || resolveLabel(numeric);
  const variant = resolveVariant(numeric);
  const warnings = [
    ...(Number(coverageScore || 0) < 60 ? ['Limited data coverage'] : []),
    ...(hasNews === false ? ['No recent company news'] : []),
  ];

  return (
    <div className="group relative inline-flex">
      <div tabIndex={0} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950">
        <Badge variant={variant}>{`DCS ${Math.round(numeric)} · ${resolvedLabel}`}</Badge>
      </div>
      <div className="pointer-events-none absolute left-1/2 top-[calc(100%+0.65rem)] z-20 w-72 -translate-x-1/2 rounded-2xl border border-slate-700/80 bg-slate-950/95 p-3 text-left text-xs text-slate-200 opacity-0 shadow-[0_20px_60px_rgba(2,6,23,0.55)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        <div className="font-semibold text-slate-50">{`Data Confidence: ${Math.round(numeric)} (${resolvedLabel})`}</div>
        <div className="mt-2 space-y-1 text-slate-300">
          <div>{`Coverage: ${formatMetric(coverageScore)}%`}</div>
          <div>{`Freshness: ${formatMetric(freshnessScore)}`}</div>
          <div>{`Sources: ${formatMetric(sourceQuality)}`}</div>
        </div>
        {warnings.length > 0 ? (
          <div className="mt-3 space-y-1 border-t border-slate-800 pt-2 text-amber-200">
            {warnings.map((warning) => (
              <div key={warning}>{`⚠️ ${warning}`}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}