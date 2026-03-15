import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Radar } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout';
import AdminTable from '../../components/admin/AdminTable';
import KPICard from '../../components/admin/KPICard';
import { apiClient } from '../../api/apiClient';

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(value) {
  return `${(toNum(value) * 100).toFixed(1)}%`;
}

function SignalIntelligenceAdmin() {
  const query = useQuery({
    queryKey: ['admin-signal-intelligence'],
    queryFn: async () => {
      const [opportunities, orderFlow, accumulation, strategy] = await Promise.all([
        apiClient('/opportunities/top?limit=50').catch(() => ({ items: [] })),
        apiClient('/intelligence/order-flow').catch(() => ({ items: [] })),
        apiClient('/intelligence/early-accumulation').catch(() => ({ items: [] })),
        apiClient('/strategy/performance').catch(() => ({ items: [] })),
      ]);

      return {
        opportunities: opportunities?.items || [],
        orderFlow: orderFlow?.items || [],
        accumulation: accumulation?.items || [],
        strategy: strategy?.items || [],
      };
    },
    refetchInterval: 30000,
  });

  const topCards = useMemo(() => {
    const data = query.data || {};
    return [
      {
        title: 'Top Ranked Opportunities',
        value: `${(data.opportunities || []).length}`,
        trend: '+ active ranking',
        trendDirection: 'up',
        icon: Radar,
        sparklineData: [8, 10, 12, 11, 14, 16, (data.opportunities || []).length || 0],
      },
      {
        title: 'Order Flow Signals',
        value: `${(data.orderFlow || []).length}`,
        trend: '+ pressure updates',
        trendDirection: 'up',
        icon: Radar,
        sparklineData: [5, 7, 9, 8, 11, 10, (data.orderFlow || []).length || 0],
      },
      {
        title: 'Early Accumulation',
        value: `${(data.accumulation || []).length}`,
        trend: '+ watchlist',
        trendDirection: 'up',
        icon: Radar,
        sparklineData: [3, 4, 6, 5, 7, 9, (data.accumulation || []).length || 0],
      },
    ];
  }, [query.data]);

  const opportunityColumns = [
    { key: 'symbol', label: 'Symbol', accessor: 'symbol', sortable: true },
    { key: 'strategy', label: 'Strategy', accessor: 'strategy', sortable: true },
    { key: 'score', label: 'Score', accessor: (row) => toNum(row.score), type: 'number', align: 'right', sortable: true },
    {
      key: 'confidence',
      label: 'Confidence',
      accessor: (row) => Math.max(0, Math.min(100, toNum(row.score) * 10)),
      type: 'progress',
      sortable: true,
    },
  ];

  const orderFlowColumns = [
    { key: 'symbol', label: 'Symbol', accessor: 'symbol', sortable: true },
    { key: 'pressure', label: 'Pressure', accessor: 'pressure_level', type: 'badge', sortable: true },
    { key: 'score', label: 'Score', accessor: (row) => Number(toNum(row.pressure_score).toFixed(2)), type: 'number', align: 'right', sortable: true },
    {
      key: 'pressureBar',
      label: 'Pressure',
      accessor: (row) => Math.max(0, Math.min(100, toNum(row.pressure_score) * 20)),
      type: 'progress',
      sortable: true,
    },
  ];

  const accumulationColumns = [
    { key: 'symbol', label: 'Symbol', accessor: 'symbol', sortable: true },
    { key: 'pressure', label: 'Pressure', accessor: 'pressure_level', type: 'badge', sortable: true },
    {
      key: 'confidence',
      label: 'Confidence',
      accessor: (row) => Math.max(0, Math.min(100, toNum(row.accumulation_score) * 10)),
      type: 'progress',
      sortable: true,
    },
    { key: 'move', label: 'Result', accessor: (row) => `${toNum(row.max_move_percent).toFixed(2)}%`, sortable: true },
  ];

  const strategyColumns = [
    { key: 'strategy', label: 'Strategy', accessor: 'strategy', sortable: true },
    { key: 'winRate', label: 'Win Rate', accessor: (row) => pct(row.win_rate), sortable: true },
    { key: 'avgMove', label: 'Avg Move', accessor: (row) => `${toNum(row.avg_move).toFixed(2)}%`, sortable: true },
    {
      key: 'outcome',
      label: 'Outcome',
      accessor: (row) => Math.max(0, Math.min(100, toNum(row.win_rate) * 100)),
      type: 'progress',
      sortable: true,
    },
  ];

  return (
    <AdminLayout title="Signal Intelligence" subtitle="Ranked opportunities, pressure flow, and strategy outcomes">
      <div className="space-y-4">
        {query.isLoading ? <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Loading signal intelligence...</div> : null}
        {query.error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">Failed to load signal intelligence data.</div> : null}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {topCards.map((card) => (
            <KPICard
              key={card.title}
              title={card.title}
              value={card.value}
              trend={card.trend}
              trendDirection={card.trendDirection}
              icon={card.icon}
              sparklineData={card.sparklineData}
            />
          ))}
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Top Ranked Opportunities</h2>
            <AdminTable columns={opportunityColumns} rows={query.data?.opportunities || []} rowKey="symbol" />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Order Flow Signals</h2>
            <AdminTable columns={orderFlowColumns} rows={query.data?.orderFlow || []} rowKey="id" />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Early Accumulation Signals</h2>
            <AdminTable
              columns={accumulationColumns}
              rows={(query.data?.accumulation || []).map((row) => ({
                ...row,
                move: row.max_move_percent,
              }))}
              rowKey="id"
              rowActions={(row) => {
                const up = toNum(row.max_move_percent) >= 0;
                return (
                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? 'text-green-400' : 'text-red-400'}`}>
                    {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {toNum(row.max_move_percent).toFixed(2)}%
                  </span>
                );
              }}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Strategy Outcomes</h2>
            <AdminTable columns={strategyColumns} rows={query.data?.strategy || []} rowKey="strategy" />
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}

export default memo(SignalIntelligenceAdmin);
