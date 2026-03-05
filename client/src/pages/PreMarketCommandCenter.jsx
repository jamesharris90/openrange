import { useEffect, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import OpportunityStream from '../components/opportunity/OpportunityStream';
import MarketNarrative from '../components/narrative/MarketNarrative';
import { apiJSON } from '../config/api';

function getSymbolMap(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const symbol = String(row?.symbol || '').toUpperCase();
    if (symbol) map.set(symbol, row);
  });
  return map;
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

export default function PreMarketCommandCenter() {
  const [metrics, setMetrics] = useState({ loading: true, rows: [] });
  const [catalysts, setCatalysts] = useState({ loading: true, rows: [] });
  const [scanner, setScanner] = useState({ loading: true, rows: [] });
  const [setups, setSetups] = useState({ loading: true, rows: [] });
  const [earnings, setEarnings] = useState({ loading: true, rows: [] });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/metrics');
        if (!cancelled) setMetrics({ loading: false, rows: Array.isArray(payload) ? payload : [] });
      } catch {
        if (!cancelled) setMetrics({ loading: false, rows: [] });
      }

      try {
        const payload = await apiJSON('/api/catalysts');
        if (!cancelled) setCatalysts({ loading: false, rows: Array.isArray(payload) ? payload : [] });
      } catch {
        if (!cancelled) setCatalysts({ loading: false, rows: [] });
      }

      try {
        const payload = await apiJSON('/api/scanner');
        const rows = Array.isArray(payload) ? payload : [];
        if (!cancelled) setScanner({ loading: false, rows: rows.filter((r) => Number(r?.gap_percent) > 3) });
      } catch {
        if (!cancelled) setScanner({ loading: false, rows: [] });
      }

      try {
        const payload = await apiJSON('/api/setups');
        const rows = Array.isArray(payload) ? payload : [];
        if (!cancelled) setSetups({ loading: false, rows: rows.slice(0, 10) });
      } catch {
        if (!cancelled) setSetups({ loading: false, rows: [] });
      }

      try {
        const payload = await apiJSON('/api/earnings');
        if (!cancelled) setEarnings({ loading: false, rows: Array.isArray(payload) ? payload : [] });
      } catch {
        if (!cancelled) setEarnings({ loading: false, rows: [] });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const bias = useMemo(() => {
    const map = getSymbolMap(metrics.rows);
    const spy = map.get('SPY') || {};
    const qqq = map.get('QQQ') || {};
    const vix = map.get('VIX') || map.get('^VIX') || {};
    return {
      spy,
      qqq,
      vix,
      regime: getRegime(spy, qqq, vix),
    };
  }, [metrics.rows]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Pre-Market Command Center"
          subtitle="Session preparation with bias, catalysts, gaps, setups, and earnings context."
        />
      </Card>

      <Card>
        <h3 className="m-0 mb-3">Market Narrative</h3>
        <MarketNarrative />
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <h3 className="m-0 mb-3">Market Bias</h3>
          {metrics.loading ? (
            <LoadingSpinner message="Loading market bias…" />
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>SPY</span><strong>{Number(bias.spy?.change_percent ?? bias.spy?.gap_percent ?? 0).toFixed(2)}%</strong></div>
              <div className="flex items-center justify-between"><span>QQQ</span><strong>{Number(bias.qqq?.change_percent ?? bias.qqq?.gap_percent ?? 0).toFixed(2)}%</strong></div>
              <div className="flex items-center justify-between"><span>VIX</span><strong>{Number(bias.vix?.price ?? bias.vix?.last ?? 0).toFixed(2)}</strong></div>
              <div className="flex items-center justify-between"><span>Market Regime</span><strong>{bias.regime}</strong></div>
            </div>
          )}
        </Card>

        <Panel
          title="Overnight Catalysts"
          loading={catalysts.loading}
          rows={catalysts.rows}
          emptyMessage="No catalysts available."
          render={(rows) => (
            <div className="space-y-2">
              {rows.slice(0, 10).map((row, idx) => (
                <div key={`${row?.symbol || idx}-${row?.published_at || idx}`} className="rounded border border-[var(--border-color)] p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <strong>{String(row?.symbol || '').toUpperCase() || '--'}</strong>
                    <span className="muted">{row?.sentiment || 'neutral'}</span>
                  </div>
                  <div>{row?.headline || '--'}</div>
                  <div className="muted text-xs">{row?.published_at ? new Date(row.published_at).toLocaleString() : '--'}</div>
                </div>
              ))}
            </div>
          )}
        />

        <Panel
          title="Gap Leaders"
          loading={scanner.loading}
          rows={scanner.rows}
          emptyMessage="No gap leaders above 3%."
          render={(rows) => (
            <table className="data-table data-table--compact">
              <thead><tr><th>Ticker</th><th style={{ textAlign: 'right' }}>Gap %</th><th style={{ textAlign: 'right' }}>RVol</th></tr></thead>
              <tbody>
                {rows.slice(0, 10).map((row) => (
                  <tr key={row?.symbol}>
                    <td>{String(row?.symbol || '').toUpperCase()}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.gap_percent || 0).toFixed(2)}%</td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.relative_volume || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />

        <Panel
          title="Top Strategy Setups"
          loading={setups.loading}
          rows={setups.rows}
          emptyMessage="No setup signals available."
          render={(rows) => (
            <table className="data-table data-table--compact">
              <thead><tr><th>Ticker</th><th>Setup</th><th style={{ textAlign: 'right' }}>Score</th></tr></thead>
              <tbody>
                {rows.map((row) => (
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
      </div>

      <Panel
        title="Earnings Today"
        loading={earnings.loading}
        rows={earnings.rows}
        emptyMessage="No earnings entries available."
        render={(rows) => (
          <table className="data-table data-table--compact">
            <thead><tr><th>Ticker</th><th>Company</th><th>Time</th></tr></thead>
            <tbody>
              {rows.slice(0, 15).map((row, idx) => (
                <tr key={`${row?.symbol || idx}-${row?.date || row?.time || idx}`}>
                  <td>{String(row?.symbol || row?.ticker || '').toUpperCase() || '--'}</td>
                  <td>{row?.company_name || row?.name || '--'}</td>
                  <td>{row?.time || row?.session || row?.date || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />

      <Card>
        <h3 className="m-0 mb-3">Opportunity Stream Preview</h3>
        <OpportunityStream limit={8} compact />
      </Card>
    </PageContainer>
  );
}
