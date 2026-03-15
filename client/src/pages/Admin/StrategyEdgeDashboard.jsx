import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/apiClient';
import AdminLayout from '../../components/admin/AdminLayout';
import MetricCard from '../../components/admin/MetricCard';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function StrategyEdgeDashboard() {
  const strategiesQuery = useQuery({
    queryKey: ['admin-strategy-edge'],
    queryFn: () => apiClient('/admin/learning/strategies'),
    refetchInterval: 45000,
  });

  const items = Array.isArray(strategiesQuery.data?.items) ? strategiesQuery.data.items : [];

  const stats = useMemo(() => {
    const total = items.length;
    const top = items[0] || null;
    const avgWinRate = total ? items.reduce((acc, row) => acc + toNum(row.win_rate), 0) / total : 0;

    return {
      total,
      topStrategy: top?.strategy || 'n/a',
      topEdge: toNum(top?.edge_score).toFixed(4),
      avgWinRate: (avgWinRate * 100).toFixed(2),
    };
  }, [items]);

  return (
    <AdminLayout title="Signal Strategy Edge">
      <div className="space-y-4">
        {strategiesQuery.isLoading ? <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text-muted)]">Loading strategy rankings...</div> : null}
        {strategiesQuery.error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">Failed to load strategy edge rankings.</div> : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Tracked Strategies" value={stats.total} subtitle="Current ranking set" status="healthy" />
          <MetricCard title="Top Strategy" value={stats.topStrategy} subtitle="Highest edge" status="healthy" />
          <MetricCard title="Top Edge Score" value={stats.topEdge} subtitle="Current leader" status={toNum(stats.topEdge) > 1 ? 'healthy' : 'warning'} />
          <MetricCard title="Average Win Rate" value={`${stats.avgWinRate}%`} subtitle="Across all strategies" status={toNum(stats.avgWinRate) > 50 ? 'healthy' : 'warning'} />
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)]">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)]">
                <th className="px-3 py-2">Strategy</th>
                <th className="px-3 py-2 text-right">Signals</th>
                <th className="px-3 py-2 text-right">Win Rate</th>
                <th className="px-3 py-2 text-right">Avg Return</th>
                <th className="px-3 py-2 text-right">Expected Move Hit</th>
                <th className="px-3 py-2 text-right">False Signal Rate</th>
                <th className="px-3 py-2 text-right">Edge Score</th>
                <th className="px-3 py-2 text-right">Learning Score</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.strategy} className="border-t border-[var(--border-color)]">
                  <td className="px-3 py-2">{item.strategy}</td>
                  <td className="px-3 py-2 text-right">{toNum(item.signals_count)}</td>
                  <td className="px-3 py-2 text-right">{(toNum(item.win_rate) * 100).toFixed(2)}%</td>
                  <td className="px-3 py-2 text-right">{toNum(item.avg_return).toFixed(2)}%</td>
                  <td className="px-3 py-2 text-right">{(toNum(item.expected_move_hit_rate) * 100).toFixed(2)}%</td>
                  <td className="px-3 py-2 text-right">{(toNum(item.false_signal_rate) * 100).toFixed(2)}%</td>
                  <td className="px-3 py-2 text-right">{toNum(item.edge_score).toFixed(4)}</td>
                  <td className="px-3 py-2 text-right">{toNum(item.learning_score).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
