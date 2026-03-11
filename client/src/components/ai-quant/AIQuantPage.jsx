import { useEffect, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '../layout/PagePrimitives';
import Card from '../shared/Card';
import SkeletonTable from '../ui/SkeletonTable';
import TickerLink from '../shared/TickerLink';
import { apiJSON } from '../../config/api';

function fmt(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

export default function AIQuantPage() {
  const [rows, setRows] = useState([]);
  const [rules, setRules] = useState(null);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [setupsPayload, rulesPayload] = await Promise.all([
          apiJSON('/api/setups'),
          apiJSON('/api/scoring-rules'),
        ]);

        if (cancelled) return;
        const setupRows = Array.isArray(setupsPayload) ? setupsPayload : [];
        setRows(setupRows);
        setRules(rulesPayload || null);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load AI Quant intelligence');
          setRows([]);
          setRules(null);
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

  const normalizedRows = useMemo(() => {
    return rows?.map((row) => ({
      symbol: String(row?.symbol || '').toUpperCase(),
      score: row?.score,
      setupType: row?.setup_type || row?.setup,
      price: row?.price,
      expectedMove: row?.expected_move ?? row?.expectedMove,
      rvol: row?.relative_volume ?? row?.rvol,
      catalystStrength: row?.catalyst_strength ?? row?.catalyst_score,
      raw: row,
    }));
  }, [rows]);

  const selectedRow = useMemo(
    () => normalizedRows.find((row) => row.symbol === selectedSymbol) || null,
    [normalizedRows, selectedSymbol],
  );

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="AI Quant"
          subtitle="Engine-backed setup ranking with scoring-rule detail breakdown."
        />
      </Card>

      {loading && <SkeletonTable rows={8} cols={7} />}
      {!loading && error && <Card><div className="muted">{error}</div></Card>}

      {!loading && !error && (
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
          <Card>
            <h3 className="m-0 mb-3">Setup Table</h3>
            {normalizedRows.length === 0 ? (
              <div className="muted">No setups available.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table data-table--compact min-w-[860px]">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'right' }}>Score</th>
                      <th>Ticker</th>
                      <th>Setup Type</th>
                      <th style={{ textAlign: 'right' }}>Price</th>
                      <th style={{ textAlign: 'right' }}>Expected Move</th>
                      <th style={{ textAlign: 'right' }}>RVol</th>
                      <th style={{ textAlign: 'right' }}>Catalyst Strength</th>
                    </tr>
                  </thead>
                  <tbody>
                    {normalizedRows?.map((row) => (
                      <tr
                        key={`${row.symbol}-${row.setupType || ''}`}
                        onClick={() => setSelectedSymbol(row.symbol)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ textAlign: 'right' }}>{fmt(row.score, 1)}</td>
                        <td style={{ fontWeight: 700 }}><TickerLink symbol={row.symbol} /></td>
                        <td>{row.setupType || '--'}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(row.price, 2)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(row.expectedMove, 2)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(row.rvol, 2)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(row.catalystStrength, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Scoring Breakdown</h3>
            {!selectedRow ? (
              <div className="muted">Select a setup row to view its scoring context.</div>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <div><strong>Symbol:</strong> {selectedRow.symbol}</div>
                  <div><strong>Setup:</strong> {selectedRow.setupType || '--'}</div>
                  <div><strong>Score:</strong> {fmt(selectedRow.score, 1)}</div>
                </div>
                <div>
                  <strong>Strategy Rules</strong>
                  <pre style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>
                    {JSON.stringify(rules?.strategy || {}, null, 2)}
                  </pre>
                </div>
                <div>
                  <strong>Catalyst Scores</strong>
                  <pre style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>
                    {JSON.stringify(rules?.catalyst_scores || {}, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
