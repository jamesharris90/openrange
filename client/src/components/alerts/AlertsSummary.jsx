import Card from '../shared/Card';

function formatTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString();
}

export default function AlertsSummary({ alerts = [], history = [], loading = false }) {
  const activeAlerts = alerts.filter((item) => item?.enabled).length;
  const totalAlerts = alerts.length;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const triggeredToday = history.filter((item) => {
    const ts = new Date(item?.triggered_at || 0);
    return !Number.isNaN(ts.getTime()) && ts >= today;
  }).length;

  const lastTriggerTime = history[0]?.triggered_at || null;

  const cards = [
    { label: 'Active Alerts', value: activeAlerts },
    { label: 'Triggered Today', value: triggeredToday },
    { label: 'Total Alerts', value: totalAlerts },
    { label: 'Last Trigger Time', value: formatTime(lastTriggerTime) },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((item) => (
        <Card key={item.label} className="rounded-xl border border-[var(--border-color)] p-3 transition-colors hover:bg-[var(--bg-card-hover)]">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{item.label}</div>
          <div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
            {loading ? <span className="inline-block h-7 w-20 animate-pulse rounded bg-[var(--bg-card-hover)]" /> : item.value}
          </div>
        </Card>
      ))}
    </div>
  );
}
