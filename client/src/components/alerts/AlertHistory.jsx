import Card from '../shared/Card';

function formatTriggeredAt(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString();
}

export default function AlertHistory({ history = [], alertsById = new Map(), loading = false }) {
  if (loading) {
    return (
      <Card className="space-y-2 rounded-2xl p-3">
        <div className="h-5 w-44 animate-pulse rounded bg-[var(--bg-card-hover)]" />
        <div className="h-20 animate-pulse rounded bg-[var(--bg-card-hover)]" />
        <div className="h-20 animate-pulse rounded bg-[var(--bg-card-hover)]" />
      </Card>
    );
  }

  if (!history.length) {
    return (
      <Card className="rounded-2xl p-3 text-sm text-[var(--text-muted)]">
        No triggered alerts yet.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {history.map((item, index) => {
        const symbol = String(item?.symbol || '').toUpperCase();
        const alertName = alertsById.get(item.alert_id)?.alert_name || 'Alert';
        return (
          <Card key={`${item.alert_id || 'alert'}-${item.triggered_at || index}`} className="rounded-2xl border border-[var(--border-color)] p-3 transition-colors hover:bg-[var(--bg-card-hover)]">
            <div className="flex items-start gap-3">
              <div className="relative mt-1">
                <span className="block h-2.5 w-2.5 rounded-full bg-[var(--accent-blue)]" />
                {index < history.length - 1 ? (
                  <span className="absolute left-1 top-2.5 block h-[42px] w-[1px] bg-[var(--border-color)]" />
                ) : null}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{symbol || '--'}</span>
                  <span className="text-xs text-[var(--text-secondary)]">{alertName}</span>
                </div>
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">{formatTriggeredAt(item.triggered_at)}</div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">{item?.message || 'Alert triggered.'}</div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="btn-secondary rounded-md px-2 py-1 text-xs"
                    onClick={() => window.location.assign(`/charts?symbol=${encodeURIComponent(symbol)}`)}
                  >
                    Open Chart
                  </button>
                  <button
                    type="button"
                    className="btn-secondary rounded-md px-2 py-1 text-xs"
                    onClick={() => window.location.assign(`/screener?symbol=${encodeURIComponent(symbol)}`)}
                  >
                    View Screener
                  </button>
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
