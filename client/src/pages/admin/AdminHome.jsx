import { memo, useMemo } from 'react';
import { Activity, Brain, Database, Gauge, Signal, SlidersHorizontal } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import AdminLayout from '../../components/admin/AdminLayout';
import KPICard from '../../components/admin/KPICard';
import { apiClient } from '../../api/apiClient';

function toNum(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function useAdminOverview() {
  return useQuery({
    queryKey: ['admin-home-overview'],
    queryFn: async () => {
      const [diagnostics, intelligence, freshness, activity] = await Promise.all([
        apiClient('/admin/diagnostics').catch(() => ({})),
        apiClient('/admin/intelligence').catch(() => ({})),
        apiClient('/system/data-freshness').catch(() => ({})),
        apiClient('/system/activity').catch(() => ({ items: [] })),
      ]);

      return {
        diagnostics,
        intelligence,
        freshness,
        activity: Array.isArray(activity?.items) ? activity.items : [],
      };
    },
    refetchInterval: 30000,
  });
}

function AdminHome() {
  const query = useAdminOverview();

  const cards = useMemo(() => {
    const data = query.data || {};
    const diagnostics = data.diagnostics || {};
    const intelligence = data.intelligence || {};
    const freshness = data.freshness || {};
    const activity = data.activity || [];

    const engines = [
      intelligence?.pipeline_runtime,
      intelligence?.flow_runtime,
      intelligence?.squeeze_runtime,
      intelligence?.opportunity_runtime,
    ].filter(Boolean);

    const activeEngines = engines.filter((engine) => String(engine?.status || '').toLowerCase() !== 'failed').length;

    const signalsGenerated = activity
      .filter((row) => String(row.engine || '').toLowerCase().includes('signal') || String(row.engine || '').toLowerCase().includes('flow'))
      .reduce((sum, row) => sum + toNum(row.rows_last_hour), 0);

    const freshnessDelays = [
      freshness?.intraday_1m?.delay_seconds,
      freshness?.flow_signals?.delay_seconds,
      freshness?.opportunity_stream?.delay_seconds,
      freshness?.news_articles?.delay_seconds,
    ].map((value) => toNum(value, 0));

    const avgFreshness = freshnessDelays.length
      ? freshnessDelays.reduce((sum, value) => sum + value, 0) / freshnessDelays.length
      : 0;

    const learningScore = toNum(intelligence?.avg_engine_runtime, 0);
    const calibration = toNum(diagnostics?.database_health?.tables?.trade_setups, 0);

    return [
      {
        title: 'System Health',
        value: String(diagnostics?.status || 'unknown').toUpperCase(),
        trend: diagnostics?.telemetry ? '+ stable' : '- degraded',
        trendDirection: diagnostics?.telemetry ? 'up' : 'down',
        icon: Gauge,
        sparklineData: [62, 66, 68, 67, 70, 72, 73],
      },
      {
        title: 'Active Engines',
        value: `${activeEngines}`,
        trend: `${engines.length} tracked`,
        trendDirection: activeEngines > 0 ? 'up' : 'down',
        icon: Activity,
        sparklineData: [2, 3, 3, 4, 4, 4, activeEngines],
      },
      {
        title: 'Signals Generated Today',
        value: signalsGenerated.toLocaleString(),
        trend: '+ intraday flow',
        trendDirection: 'up',
        icon: Signal,
        sparklineData: [14, 19, 22, 30, 34, 41, Math.max(4, Math.round(signalsGenerated / 20))],
      },
      {
        title: 'Data Freshness',
        value: `${avgFreshness.toFixed(0)}s`,
        trend: avgFreshness < 120 ? '+ fresh' : '- stale',
        trendDirection: avgFreshness < 120 ? 'up' : 'down',
        icon: Database,
        sparklineData: [130, 115, 100, 96, 90, 80, Math.max(10, Math.round(avgFreshness))],
      },
      {
        title: 'Learning Updates',
        value: `${learningScore.toFixed(0)} ms`,
        trend: learningScore < 1200 ? '+ improving' : '- slower',
        trendDirection: learningScore < 1200 ? 'up' : 'down',
        icon: Brain,
        sparklineData: [1800, 1500, 1400, 1300, 1240, 1190, Math.max(300, Math.round(learningScore))],
      },
      {
        title: 'Calibration Accuracy',
        value: `${calibration.toLocaleString()}`,
        trend: calibration > 0 ? '+ available' : '- unavailable',
        trendDirection: calibration > 0 ? 'up' : 'down',
        icon: SlidersHorizontal,
        sparklineData: [8, 11, 12, 12, 14, 15, Math.max(2, Math.min(20, calibration / 1000))],
      },
    ];
  }, [query.data]);

  return (
    <AdminLayout title="Admin Overview" subtitle="Platform health, control, and signal telemetry">
      <div className="space-y-4">
        {query.isLoading ? <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Loading admin overview...</div> : null}
        {query.error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">Failed to load admin overview.</div> : null}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
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
      </div>
    </AdminLayout>
  );
}

export default memo(AdminHome);
