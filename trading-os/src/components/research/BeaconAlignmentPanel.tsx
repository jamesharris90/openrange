export interface BeaconAlignment {
  in_picks: boolean;
  pattern?: string | null;
  signals_aligned?: string[];
  signal_count?: number;
  reasoning?: string | null;
  run_started_at?: string | null;
}

interface Props {
  alignment: BeaconAlignment | null | undefined;
}

export default function BeaconAlignmentPanel({ alignment }: Props) {
  if (!alignment || !alignment.in_picks) return null;

  const signalsAligned = Array.isArray(alignment.signals_aligned) ? alignment.signals_aligned : [];
  const signalCount = Number(alignment.signal_count || signalsAligned.length || 0);

  const tierColor = signalCount >= 4
    ? "border-emerald-600 bg-emerald-950/30"
    : signalCount >= 3
      ? "border-cyan-700 bg-cyan-950/30"
      : "border-slate-700 bg-slate-950/50";

  const tierLabel = signalCount >= 4
    ? "HIGH ALIGNMENT"
    : signalCount >= 3
      ? "MEDIUM ALIGNMENT"
      : "EMERGING ALIGNMENT";

  return (
    <section className={`rounded-2xl border p-6 ${tierColor}`}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div>
          <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">Beacon Alignment</div>
          <div className="text-lg font-medium text-slate-100">{alignment.pattern || "Beacon pick"}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-100">
            {signalCount}
            <span className="ml-1 text-sm font-normal text-slate-500">signals</span>
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{tierLabel}</div>
        </div>
      </div>

      {alignment.reasoning ? <div className="mb-4 text-sm leading-6 text-slate-300">{alignment.reasoning}</div> : null}

      <div className="flex flex-wrap gap-1.5">
        {signalsAligned.map((signal) => (
          <span key={signal} className="rounded bg-slate-800/50 px-2 py-1 text-xs text-slate-400">
            {formatSignalName(signal)}
          </span>
        ))}
      </div>
    </section>
  );
}

function formatSignalName(signal: string): string {
  const map: Record<string, string> = {
    top_rvol_today: "High Volume",
    top_gap_today: "Gap",
    top_news_last_12h: "News",
    earnings_upcoming_within_3d: "Pre-Earnings",
    earnings_reaction_last_3d: "Earnings Reaction",
    top_coiled_spring: "Coiled Spring",
    top_volume_building: "Volume Building",
    top_congressional_trades_recent: "Congressional",
  };

  return map[signal] || signal;
}
