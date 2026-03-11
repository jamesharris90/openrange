import { useEffect, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';
import AdminLayout from '../components/layout/AdminLayout';

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function pct(value) {
  return `${toNumber(value).toFixed(2)}%`;
}

function barWidth(value, max) {
  const denom = Math.max(1, toNumber(max, 1));
  return `${Math.max(3, (toNumber(value) / denom) * 100)}%`;
}

export default function SignalIntelligenceAdmin() {
  const [loading, setLoading] = useState(true);
  const [signals, setSignals] = useState([]);
  const [orderFlow, setOrderFlow] = useState([]);
  const [early, setEarly] = useState([]);
  const [strategy, setStrategy] = useState([]);
  const [newsletter, setNewsletter] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [topPayload, orderFlowPayload, earlyPayload, strategyPayload, newsletterPayload] = await Promise.all([
          apiJSON('/api/opportunities/top?limit=25').catch(() => ({ items: [] })),
          apiJSON('/api/intelligence/order-flow').catch(() => ({ items: [] })),
          apiJSON('/api/intelligence/early-accumulation').catch(() => ({ items: [] })),
          apiJSON('/api/strategy/performance').catch(() => ({ items: [] })),
          apiJSON('/api/newsletter/preview').catch(() => ({ payload: null })),
        ]);

        if (cancelled) return;
        setSignals(Array.isArray(topPayload?.items) ? topPayload.items : []);
        setOrderFlow(Array.isArray(orderFlowPayload?.items) ? orderFlowPayload.items : []);
        setEarly(Array.isArray(earlyPayload?.items) ? earlyPayload.items : []);
        setStrategy(Array.isArray(strategyPayload?.items) ? strategyPayload.items : []);
        setNewsletter(newsletterPayload?.payload || null);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load signal admin view.');
          setSignals([]);
          setOrderFlow([]);
          setEarly([]);
          setStrategy([]);
          setNewsletter(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const topScore = useMemo(() => Math.max(1, ...(signals || []).map((row) => toNumber(row?.score))), [signals]);
  const topPressure = useMemo(() => Math.max(1, ...(orderFlow || []).map((row) => toNumber(row?.pressure_score))), [orderFlow]);
  const maxMove = useMemo(() => Math.max(1, ...(strategy || []).map((row) => Math.abs(toNumber(row?.max_move)))), [strategy]);

  return (
    <PageContainer className="space-y-3">
      <AdminLayout section="Signal Intelligence" />

      <Card>
        <PageHeader
          title="Signal Intelligence Admin"
          subtitle="Operational panel for signal quality, order-flow pressure, early accumulation, and strategy outcomes."
        />
      </Card>

      {loading ? (
        <Card><LoadingSpinner message="Loading signal intelligence admin..." /></Card>
      ) : error ? (
        <Card><div className="muted">{error}</div></Card>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-4">
            <Card><div className="muted text-xs">Top Signals</div><div className="text-2xl font-semibold">{signals.length}</div></Card>
            <Card><div className="muted text-xs">Order Flow Signals</div><div className="text-2xl font-semibold">{orderFlow.length}</div></Card>
            <Card><div className="muted text-xs">Early Accumulation</div><div className="text-2xl font-semibold">{early.length}</div></Card>
            <Card><div className="muted text-xs">Strategies Tracked</div><div className="text-2xl font-semibold">{strategy.length}</div></Card>
          </div>

          <Card>
            <h3 className="m-0 mb-3">Top Signals</h3>
            <div className="space-y-2 text-sm">
              {(signals || []).slice(0, 15).map((row) => (
                <div key={String(row?.symbol || row?.id)}>
                  <div className="mb-1 flex items-center justify-between">
                    <span>{row?.symbol || '--'} • {row?.strategy || 'Setup'}</span>
                    <strong>{toNumber(row?.score).toFixed(1)}</strong>
                  </div>
                  <div className="h-2 rounded bg-[var(--bg-card-hover)]">
                    <div className="h-2 rounded bg-[var(--accent-blue)]" style={{ width: barWidth(row?.score, topScore) }} />
                  </div>
                  <div className="muted mt-1 text-xs">{row?.signal_explanation || row?.rationale || 'No explanation available'}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Order Flow Signals</h3>
            {!orderFlow.length ? (
              <div className="muted">No order flow detections available.</div>
            ) : (
              <div className="space-y-2 text-sm">
                {(orderFlow || []).slice(0, 20).map((row) => (
                  <div key={String(row?.id || `${row?.symbol}-${row?.detected_at}`)}>
                    <div className="mb-1 flex items-center justify-between">
                      <span>{row?.symbol || '--'} • {row?.pressure_level || 'WEAK'}</span>
                      <strong>{toNumber(row?.pressure_score).toFixed(2)}</strong>
                    </div>
                    <div className="h-2 rounded bg-[var(--bg-card-hover)]">
                      <div className="h-2 rounded bg-[var(--accent-green, #22c55e)]" style={{ width: barWidth(row?.pressure_score, topPressure) }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Early Accumulation Signals</h3>
            {!early.length ? (
              <div className="muted">No early accumulation data available.</div>
            ) : (
              <div className="overflow-auto">
                <table className="data-table data-table--compact min-w-[820px]">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Pressure</th>
                      <th style={{ textAlign: 'right' }}>Score</th>
                      <th style={{ textAlign: 'right' }}>Liquidity</th>
                      <th style={{ textAlign: 'right' }}>Float</th>
                      <th style={{ textAlign: 'right' }}>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(early || []).slice(0, 20).map((row) => (
                      <tr key={String(row?.id || `${row?.symbol}-${row?.detected_at}`)}>
                        <td>{row?.symbol || '--'}</td>
                        <td>{row?.pressure_level || '--'}</td>
                        <td style={{ textAlign: 'right' }}>{toNumber(row?.accumulation_score).toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }}>{toNumber(row?.liquidity_surge).toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }}>{toNumber(row?.float_rotation).toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }}>{pct(row?.max_move_percent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Strategy Outcomes</h3>
            {!strategy.length ? (
              <div className="muted">No strategy outcome rows found.</div>
            ) : (
              <div className="space-y-2 text-sm">
                {(strategy || []).map((row) => (
                  <div key={String(row?.strategy || 'unknown')}>
                    <div className="mb-1 flex items-center justify-between">
                      <span>{row?.strategy || 'Unknown'}</span>
                      <span>Win {pct(row?.win_rate)} • Avg {pct(row?.avg_move)}</span>
                    </div>
                    <div className="h-2 rounded bg-[var(--bg-card-hover)]">
                      <div className="h-2 rounded bg-[var(--accent-orange, #f59e0b)]" style={{ width: barWidth(Math.abs(row?.max_move), maxMove) }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Newsletter Intelligence</h3>
            {!newsletter ? (
              <div className="muted">Newsletter metrics unavailable.</div>
            ) : (
              <div className="grid gap-2 md:grid-cols-4">
                <div className="rounded border border-[var(--border-color)] p-3">
                  <div className="muted text-xs">Subscriber Count</div>
                  <div className="text-xl font-semibold">{toNumber(newsletter?.meta?.subscriberCount, 0)}</div>
                </div>
                <div className="rounded border border-[var(--border-color)] p-3">
                  <div className="muted text-xs">Send History</div>
                  <div className="text-xl font-semibold">{Array.isArray(newsletter?.meta?.sendHistory) ? newsletter.meta.sendHistory.length : 0}</div>
                </div>
                <div className="rounded border border-[var(--border-color)] p-3">
                  <div className="muted text-xs">Open Rate</div>
                  <div className="text-xl font-semibold">{pct(newsletter?.meta?.averageOpenRate)}</div>
                </div>
                <div className="rounded border border-[var(--border-color)] p-3">
                  <div className="muted text-xs">Click Rate</div>
                  <div className="text-xl font-semibold">{pct(newsletter?.meta?.averageClickRate)}</div>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </PageContainer>
  );
}
