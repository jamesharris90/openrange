import Card from '../shared/Card';

function average(rows, key) {
  const values = rows.map((row) => Number(row?.[key])).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export default function ScreenerStats({ rows = [] }) {
  const resultCount = rows.length;
  const avgRvol = average(rows, 'relativeVolume');
  const avgGap = average(rows, 'gapPercent');
  const avgScore = average(rows, 'strategyScore');

  return (
    <Card className="rounded-xl border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-secondary)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>Results: <strong className="text-[var(--text-primary)]">{resultCount}</strong></span>
        <span>Avg RVOL: <strong className="text-[var(--text-primary)]">{avgRvol.toFixed(2)}</strong></span>
        <span>Avg Gap: <strong className="text-[var(--text-primary)]">{avgGap.toFixed(2)}%</strong></span>
        <span>Avg Score: <strong className="text-[var(--text-primary)]">{avgScore.toFixed(1)}</strong></span>
      </div>
    </Card>
  );
}
