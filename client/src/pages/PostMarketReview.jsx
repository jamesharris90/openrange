import { useEffect, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';

function Panel({ title, loading, rows, emptyMessage, render }) {
  return (
    <Card>
      <h3 className="m-0 mb-3">{title}</h3>
      {loading ? (
        <LoadingSpinner message={`Loading ${title.toLowerCase()}…`} />
      ) : rows.length === 0 ? (
        <div className="muted">{emptyMessage}</div>
      ) : (
        render(rows)
      )}
    </Card>
  );
}

function getRegime(spyRow, qqqRow, vixRow) {
  const spy = Number(spyRow?.change_percent ?? spyRow?.gap_percent ?? 0);
  const qqq = Number(qqqRow?.change_percent ?? qqqRow?.gap_percent ?? 0);
  const vix = Number(vixRow?.price ?? vixRow?.last ?? vixRow?.close ?? 0);
  if (!Number.isFinite(spy) || !Number.isFinite(qqq) || !Number.isFinite(vix)) return 'Unknown';
  if (spy > 0 && qqq > 0 && vix < 20) return 'Risk-On';
  if (spy < 0 && qqq < 0 && vix > 22) return 'Risk-Off';
  return 'Balanced';
}

export default function PostMarketReview() {
  const [setups, setSetups] = useState({ loading: true, rows: [] });
  const [metrics, setMetrics] = useState({ loading: true, rows: [] });
  const [scanner, setScanner] = useState({ loading: true, rows: [] });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/setups');
        if (!cancelled) setSetups({ loading: false, rows: Array.isArray(payload) ? payload : [] });
      } catch {
        if (!cancelled) setSetups({ loading: false, rows: [] });
      }

      try {
        const payload = await apiJSON('/api/metrics');
        if (!cancelled) setMetrics({ loading: false, rows: Array.isArray(payload) ? payload : [] });
      } catch {
        if (!cancelled) setMetrics({ loading: false, rows: [] });
      }

      try {
        const payload = await apiJSON('/api/scanner');
        if (!cancelled) setScanner({ loading: false, rows: Array.isArray(payload) ? payload : [] });
      } catch {
        if (!cancelled) setScanner({ loading: false, rows: [] });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const regime = useMemo(() => {
    const map = new Map();
    metrics.rows.forEach((row) => {
      const symbol = String(row?.symbol || '').toUpperCase();
      if (symbol) map.set(symbol, row);
    });
    return {
      spy: map.get('SPY') || {},
      qqq: map.get('QQQ') || {},
      vix: map.get('VIX') || map.get('^VIX') || {},
      label: getRegime(map.get('SPY') || {}, map.get('QQQ') || {}, map.get('VIX') || map.get('^VIX') || {}),
    };
  }, [metrics.rows]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Post-Market Review"
          subtitle="Session recap for signal quality, market regime, and top movers."
        />
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Signals Detected"
          loading={setups.loading}
          rows={setups.rows}
          emptyMessage="No setup signals captured."
          render={(rows) => (
            <table className="data-table data-table--compact">
              <thead><tr><th>Ticker</th><th>Setup</th><th style={{ textAlign: 'right' }}>Score</th></tr></thead>
              <tbody>
                {rows.slice(0, 12)?.map((row) => (
                  <tr key={`${row?.symbol}-${row?.setup || row?.setup_type || ''}`}>
                    <td>{String(row?.symbol || '').toUpperCase()}</td>
                    <td>{row?.setup_type || row?.setup || '--'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.score || 0).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />

        <Card>
          <h3 className="m-0 mb-3">Market Regime Summary</h3>
          {metrics.loading ? (
            <LoadingSpinner message="Loading market regime summary…" />
          ) : metrics.rows.length === 0 ? (
            <div className="muted">No market metrics available.</div>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>SPY</span><strong>{Number(regime.spy?.change_percent ?? regime.spy?.gap_percent ?? 0).toFixed(2)}%</strong></div>
              <div className="flex items-center justify-between"><span>QQQ</span><strong>{Number(regime.qqq?.change_percent ?? regime.qqq?.gap_percent ?? 0).toFixed(2)}%</strong></div>
              <div className="flex items-center justify-between"><span>VIX</span><strong>{Number(regime.vix?.price ?? regime.vix?.last ?? 0).toFixed(2)}</strong></div>
              <div className="flex items-center justify-between"><span>Regime</span><strong>{regime.label}</strong></div>
            </div>
          )}
        </Card>

        <Panel
          title="Top Movers"
          loading={scanner.loading}
          rows={scanner.rows}
          emptyMessage="No mover rows available."
          render={(rows) => {
            const sorted = [...rows].sort((a, b) => Math.abs(Number(b?.gap_percent || 0)) - Math.abs(Number(a?.gap_percent || 0)));
            return (
              <table className="data-table data-table--compact">
                <thead><tr><th>Ticker</th><th style={{ textAlign: 'right' }}>Move %</th><th style={{ textAlign: 'right' }}>RVol</th></tr></thead>
                <tbody>
                  {sorted.slice(0, 12)?.map((row) => (
                    <tr key={`${row?.symbol}-${row?.gap_percent || 0}`}>
                      <td>{String(row?.symbol || '').toUpperCase()}</td>
                      <td style={{ textAlign: 'right' }}>{Number(row?.gap_percent || 0).toFixed(2)}%</td>
                      <td style={{ textAlign: 'right' }}>{Number(row?.relative_volume || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }}
        />

        <Card>
          <h3 className="m-0 mb-3">Trading Journal</h3>
          <div className="muted">Journal module placeholder: add notes, review execution quality, and define tomorrow’s focus.</div>
        </Card>
      </div>
    </PageContainer>
  );
}
