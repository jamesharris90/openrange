import { useEffect, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtNumber(value, digits = 2) {
  const num = asNumber(value);
  if (num == null) return '--';
  return num.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtPercent(value) {
  const num = asNumber(value);
  if (num == null) return '--';
  return `${num >= 0 ? '+' : ''}${fmtNumber(num, 2)}%`;
}

function regimeFromMetrics(spy, qqq, vix) {
  const spyChange = asNumber(spy?.change_percent ?? spy?.gap_percent);
  const qqqChange = asNumber(qqq?.change_percent ?? qqq?.gap_percent);
  const vixValue = asNumber(vix?.price ?? vix?.last ?? vix?.close);

  if (spyChange == null || qqqChange == null || vixValue == null) return 'Unknown';
  if (spyChange > 0 && qqqChange > 0 && vixValue < 20) return 'Risk-On';
  if (spyChange < 0 && qqqChange < 0 && vixValue > 22) return 'Risk-Off';
  return 'Neutral';
}

export default function DashboardPage() {
  const [setups, setSetups] = useState([]);
  const [metricsRows, setMetricsRows] = useState([]);
  const [catalysts, setCatalysts] = useState([]);
  const [systemReport, setSystemReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [setupsPayload, metricsPayload, catalystsPayload, systemReportPayload] = await Promise.all([
          apiJSON('/api/setups'),
          apiJSON('/api/metrics'),
          apiJSON('/api/catalysts'),
          apiJSON('/api/system/report'),
        ]);

        if (cancelled) return;
        setSetups(Array.isArray(setupsPayload) ? setupsPayload : []);
        setMetricsRows(Array.isArray(metricsPayload) ? metricsPayload : []);
        setCatalysts(Array.isArray(catalystsPayload) ? catalystsPayload : []);
        setSystemReport(systemReportPayload && typeof systemReportPayload === 'object' ? systemReportPayload : null);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load dashboard intelligence');
          setSetups([]);
          setMetricsRows([]);
          setCatalysts([]);
          setSystemReport({ status: 'degraded', detail: err?.message || 'System report unavailable' });
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

  const metricsBySymbol = useMemo(() => {
    const map = new Map();
    metricsRows.forEach((row) => {
      const symbol = String(row?.symbol || '').toUpperCase();
      if (symbol) map.set(symbol, row);
    });
    return map;
  }, [metricsRows]);

  const opportunities = useMemo(() => {
    return setups
      .map((row) => {
        const symbol = String(row?.symbol || '').toUpperCase();
        const metric = metricsBySymbol.get(symbol) || {};
        return {
          symbol,
          setupType: row?.setup_type || row?.setup || '--',
          score: asNumber(row?.score),
          catalystHeadline: row?.catalyst_headline || '--',
          relativeVolume: asNumber(metric?.relative_volume),
          priceChange: asNumber(metric?.change_percent ?? metric?.gap_percent),
        };
      })
      .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
      .slice(0, 10);
  }, [setups, metricsBySymbol]);

  const marketContext = useMemo(() => {
    const spy = metricsBySymbol.get('SPY');
    const qqq = metricsBySymbol.get('QQQ');
    const vix = metricsBySymbol.get('VIX') || metricsBySymbol.get('^VIX');

    return {
      spy,
      qqq,
      vix,
      regime: regimeFromMetrics(spy, qqq, vix),
    };
  }, [metricsBySymbol]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Dashboard Intelligence"
          subtitle="Engine-driven opportunity feed with live catalyst and market context signals."
        />
      </Card>

      {!loading && systemReport?.status === 'degraded' && (
        <Card>
          <div className="text-sm" style={{ color: 'var(--warning-text, #f59e0b)' }}>
            System health warning: backend reported degraded status.
            {Array.isArray(systemReport?.missing_tables) && systemReport.missing_tables.length > 0
              ? ` Missing tables: ${systemReport.missing_tables.join(', ')}.`
              : ''}
            {systemReport?.detail ? ` ${systemReport.detail}` : ''}
          </div>
        </Card>
      )}

      {loading && <LoadingSpinner message="Loading dashboard intelligence…" />}
      {!loading && error && <Card><div className="muted">{error}</div></Card>}

      {!loading && !error && (
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
          <Card>
            <h3 className="m-0 mb-3">Top Opportunities</h3>
            {opportunities.length === 0 ? (
              <div className="muted">No setup opportunities available.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table data-table--compact min-w-[760px]">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Setup</th>
                      <th style={{ textAlign: 'right' }}>Score</th>
                      <th>Catalyst Headline</th>
                      <th style={{ textAlign: 'right' }}>RVol</th>
                      <th style={{ textAlign: 'right' }}>Price Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.map((row) => (
                      <tr key={`${row.symbol}-${row.setupType}`}>
                        <td style={{ fontWeight: 700 }}>{row.symbol || '--'}</td>
                        <td>{row.setupType}</td>
                        <td style={{ textAlign: 'right' }}>{fmtNumber(row.score, 1)}</td>
                        <td>{row.catalystHeadline}</td>
                        <td style={{ textAlign: 'right' }}>{fmtNumber(row.relativeVolume, 2)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtPercent(row.priceChange)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="space-y-3">
            <Card>
              <h3 className="m-0 mb-3">Market Context</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>SPY</span><strong>{fmtPercent(marketContext.spy?.change_percent ?? marketContext.spy?.gap_percent)}</strong></div>
                <div className="flex items-center justify-between"><span>QQQ</span><strong>{fmtPercent(marketContext.qqq?.change_percent ?? marketContext.qqq?.gap_percent)}</strong></div>
                <div className="flex items-center justify-between"><span>VIX</span><strong>{fmtNumber(marketContext.vix?.price ?? marketContext.vix?.last ?? marketContext.vix?.close, 2)}</strong></div>
                <div className="flex items-center justify-between"><span>Market Regime</span><strong>{marketContext.regime}</strong></div>
              </div>
            </Card>

            <Card>
              <h3 className="m-0 mb-3">Catalyst Feed</h3>
              {catalysts.length === 0 ? (
                <div className="muted">No catalysts available.</div>
              ) : (
                <div className="space-y-2">
                  {catalysts.slice(0, 12).map((item, idx) => (
                    <div key={`${item.symbol}-${item.published_at || idx}`} className="rounded border border-[var(--border)] p-2">
                      <div className="flex items-center justify-between">
                        <strong>{String(item.symbol || '').toUpperCase() || '--'}</strong>
                        <span className="muted text-xs">{item.sentiment || 'neutral'}</span>
                      </div>
                      <div className="text-sm" style={{ marginTop: 4 }}>{item.headline || '--'}</div>
                      <div className="muted text-xs" style={{ marginTop: 4 }}>{item.published_at ? new Date(item.published_at).toLocaleString() : '--'}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
