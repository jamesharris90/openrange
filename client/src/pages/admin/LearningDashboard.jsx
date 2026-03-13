import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Brain, Target, TrendingUp } from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import AdminLayout from '../../components/admin/AdminLayout';
import MetricCard from '../../components/admin/MetricCard';
import LearningScoreChart from '../../components/admin/LearningScoreChart';
import CaptureRateChart from '../../components/admin/CaptureRateChart';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeItems(data) {
  return Array.isArray(data?.items) ? data.items : [];
}

export default function LearningDashboard() {
  const strategiesQuery = useQuery({
    queryKey: ['admin-learning-strategies'],
    queryFn: () => apiClient('/admin/learning/strategies'),
    refetchInterval: 45000,
  });

  const captureQuery = useQuery({
    queryKey: ['admin-learning-capture-rate'],
    queryFn: () => apiClient('/admin/learning/capture-rate'),
    refetchInterval: 45000,
  });

  const expectedMoveQuery = useQuery({
    queryKey: ['admin-learning-expected-move'],
    queryFn: () => apiClient('/admin/learning/expected-move'),
    refetchInterval: 45000,
  });

  const regimeQuery = useQuery({
    queryKey: ['admin-learning-regime'],
    queryFn: () => apiClient('/admin/learning/regime'),
    refetchInterval: 45000,
  });

  const strategies = safeItems(strategiesQuery.data);
  const capture = safeItems(captureQuery.data);
  const expectedMove = safeItems(expectedMoveQuery.data);
  const regime = safeItems(regimeQuery.data);

  const isLoading = [strategiesQuery, captureQuery, expectedMoveQuery, regimeQuery].some((q) => q.isLoading);
  const hasError = [strategiesQuery, captureQuery, expectedMoveQuery, regimeQuery].find((q) => q.error);

  const captureSeries = useMemo(() => [...capture].reverse().map((row) => ({
    label: row.date,
    captureRate: toNum(row.capture_rate) * 100,
    opportunities: toNum(row.total_opportunities),
    signals: toNum(row.signals_detected),
  })), [capture]);

  const expectedSeries = useMemo(() => [...expectedMove].reverse().map((row) => ({
    label: row.date,
    accuracy: toNum(row.hit_rate) * 100,
    expectedMove: toNum(row.avg_expected_move_percent),
    actualMove: toNum(row.avg_actual_move_percent),
  })), [expectedMove]);

  const learningScoreSeries = useMemo(() => strategies
    .slice(0, 8)
    .map((row, idx) => ({
      label: row.strategy || `S${idx + 1}`,
      learningScore: Number(toNum(row.learning_score).toFixed(4)),
    })), [strategies]);

  const summary = useMemo(() => {
    const latestCapture = captureSeries[captureSeries.length - 1] || {};
    const latestExpected = expectedSeries[expectedSeries.length - 1] || {};
    const topStrategy = strategies[0] || {};

    return {
      captureRate: toNum(latestCapture.captureRate).toFixed(2),
      expectedAccuracy: toNum(latestExpected.accuracy).toFixed(2),
      topEdge: toNum(topStrategy.edge_score).toFixed(4),
      topStrategy: topStrategy.strategy || 'n/a',
    };
  }, [captureSeries, expectedSeries, strategies]);

  const latestRegime = regime[0] || null;

  return (
    <AdminLayout title="Learning Dashboard">
      <div className="space-y-4">
        {isLoading ? <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text-muted)]">Loading learning metrics...</div> : null}
        {hasError ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            Failed to load one or more learning data sources. Showing latest cached data where available.
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Capture Rate" value={`${summary.captureRate}%`} subtitle="Latest session" status={toNum(summary.captureRate) > 60 ? 'healthy' : 'warning'} />
          <MetricCard title="Expected Move Accuracy" value={`${summary.expectedAccuracy}%`} subtitle="Daily model hit rate" status={toNum(summary.expectedAccuracy) > 55 ? 'healthy' : 'warning'} />
          <MetricCard title="Top Strategy" value={summary.topStrategy} subtitle="Highest current edge" status="healthy" />
          <MetricCard title="Top Edge Score" value={summary.topEdge} subtitle="Rank #1 strategy" status={toNum(summary.topEdge) > 1 ? 'healthy' : 'warning'} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <LearningScoreChart data={learningScoreSeries} />
          <CaptureRateChart data={captureSeries} />
        </div>

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Target size={16} className="text-sky-300" />
            Expected Move Accuracy
          </h3>
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <LineChart data={expectedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="accuracy" stroke="#34d399" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="expectedMove" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="actualMove" stroke="#a78bfa" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <TrendingUp size={16} className="text-violet-300" />
              Strategy Edge Ranking
            </h3>
            <div className="h-80 w-full">
              <ResponsiveContainer>
                <BarChart data={strategies.slice(0, 10)} layout="vertical" margin={{ left: 24, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                  <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <YAxis type="category" dataKey="strategy" width={120} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="edge_score" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Brain size={16} className="text-emerald-300" />
              Regime Snapshot
            </h3>
            <div className="grid gap-2 text-sm text-[var(--text-secondary)]">
              <p>Regime: <span className="font-semibold text-[var(--text-primary)]">{latestRegime?.market_regime || 'n/a'}</span></p>
              <p>SPY Trend: <span className="font-semibold text-[var(--text-primary)]">{latestRegime?.spy_trend || 'n/a'}</span></p>
              <p>VIX: <span className="font-semibold text-[var(--text-primary)]">{toNum(latestRegime?.vix_level).toFixed(2)}</span></p>
              <p>Breadth: <span className="font-semibold text-[var(--text-primary)]">{toNum(latestRegime?.breadth_percent).toFixed(2)}%</span></p>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
