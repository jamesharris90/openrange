import HealthIndicator from './HealthIndicator';

export default function MetricCard({ title, value, subtitle, status }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
        {status ? <HealthIndicator status={status} /> : null}
      </div>
      <p className="text-2xl font-semibold text-[var(--text-primary)]">{value}</p>
      {subtitle ? <p className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</p> : null}
    </div>
  );
}
