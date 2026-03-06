const DELTA_STYLES = {
  up: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35',
  down: 'bg-rose-500/15 text-rose-300 border border-rose-500/35',
  neutral: 'bg-slate-500/15 text-slate-300 border border-slate-500/35',
};

export default function StatCard({
  icon: Icon,
  value,
  delta,
  deltaDirection = 'neutral',
  description,
  className = '',
}) {
  const chipClass = DELTA_STYLES[deltaDirection] || DELTA_STYLES.neutral;

  return (
    <div className={`or-card-ui ${className}`.trim()}>
      <div className="mb-2 flex items-center justify-between">
        <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 text-[var(--text-muted)]">
          {Icon ? <Icon size={16} /> : null}
        </div>
        {delta ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${chipClass}`}>{delta}</span> : null}
      </div>
      <div className="text-xl font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{description}</div>
    </div>
  );
}
