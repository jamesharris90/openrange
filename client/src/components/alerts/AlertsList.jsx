import Card from '../shared/Card';

function summarizeQueryTree(node) {
  if (!node || typeof node !== 'object') return 'No query details';

  if (node.field) {
    if (Array.isArray(node.value)) {
      return `${node.field} ${node.operator} ${node.value.join(' and ')}`;
    }
    return `${node.field} ${node.operator} ${node.value ?? ''}`.trim();
  }

  const op = node.operator || 'AND';
  const children = Array.isArray(node.conditions) ? node.conditions : [];
  if (!children.length) return `Composite rule (${op})`;

  const parts = children.slice(0, 2).map((child) => summarizeQueryTree(child));
  const suffix = children.length > 2 ? ` +${children.length - 2} more` : '';
  return `${parts.join(` ${op} `)}${suffix}`;
}

export default function AlertsList({
  alerts = [],
  loading = false,
  onToggleEnabled,
  onEdit,
  onDisable,
  onDelete,
  onTest,
}) {
  if (loading) {
    return (
      <Card className="space-y-2 rounded-2xl p-3">
        <div className="h-5 w-36 animate-pulse rounded bg-[var(--bg-card-hover)]" />
        <div className="h-24 animate-pulse rounded bg-[var(--bg-card-hover)]" />
        <div className="h-24 animate-pulse rounded bg-[var(--bg-card-hover)]" />
      </Card>
    );
  }

  if (!alerts.length) {
    return (
      <Card className="rounded-2xl p-3 text-sm text-[var(--text-muted)]">
        No alerts configured yet.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => {
        const enabled = Boolean(alert?.enabled);
        return (
          <Card
            key={alert.alert_id}
            className={`rounded-2xl border-l-4 p-3 transition-colors hover:bg-[var(--bg-card-hover)] ${
              enabled ? 'border-l-[var(--accent-green)]' : 'border-l-[var(--text-muted)]'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">{alert.alert_name || 'Untitled Alert'}</div>
                <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{summarizeQueryTree(alert.query_tree)}</div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">Frequency: {Number(alert.frequency) || 60}s</div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => onToggleEnabled?.(alert)}
                />
                <span>{enabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <button type="button" className="btn-secondary rounded-md px-2 py-1 text-xs" onClick={() => onEdit?.(alert)}>Edit</button>
              <button type="button" className="btn-secondary rounded-md px-2 py-1 text-xs" onClick={() => onDisable?.(alert)}>Disable</button>
              <button type="button" className="btn-secondary rounded-md px-2 py-1 text-xs" onClick={() => onDelete?.(alert)}>Delete</button>
              <button type="button" className="btn-secondary rounded-md px-2 py-1 text-xs" onClick={() => onTest?.(alert)}>Test Alert</button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
