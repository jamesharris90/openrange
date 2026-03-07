import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sortByScoreDesc(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort(
    (a, b) => toNumber(b?.score, 0) - toNumber(a?.score, 0),
  );
}

export default function OpenMarketRadar() {
  const [radar, setRadar] = useState({ A: [], B: [], C: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRadar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/radar');
      if (!response.ok) {
        throw new Error(`Radar request failed (${response.status})`);
      }
      const data = await response.json();
      setRadar({
        A: Array.isArray(data?.A) ? data.A : [],
        B: Array.isArray(data?.B) ? data.B : [],
        C: Array.isArray(data?.C) ? data.C : [],
      });
    } catch (fetchError) {
      console.error('[RADAR FETCH ERROR]', fetchError);
      setRadar({ A: [], B: [], C: [] });
      setError(fetchError?.message || 'Failed to fetch radar data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRadar();
    const timer = setInterval(loadRadar, 60_000);
    return () => clearInterval(timer);
  }, [loadRadar]);

  const classA = useMemo(() => sortByScoreDesc(radar.A), [radar.A]);
  const classB = useMemo(() => sortByScoreDesc(radar.B), [radar.B]);
  const classC = useMemo(() => sortByScoreDesc(radar.C), [radar.C]);

  function renderRows(rows) {
    if (!rows.length) {
      return <div className="muted">No setups right now.</div>;
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase muted">
              <th className="py-2">Symbol</th>
              <th className="py-2">Strategy</th>
              <th className="py-2">Score</th>
              <th className="py-2">Probability</th>
              <th className="py-2">Gap %</th>
              <th className="py-2">RVol</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${String(row?.symbol || 'N/A')}-${index}`} className="border-t border-[var(--border-default)]">
                <td className="py-2 font-semibold">{String(row?.symbol || 'N/A').toUpperCase()}</td>
                <td className="py-2">{row?.strategy || '--'}</td>
                <td className="py-2">{toNumber(row?.score, 0).toFixed(1)}</td>
                <td className="py-2">{(toNumber(row?.probability, 0) * 100).toFixed(1)}%</td>
                <td className="py-2">{toNumber(row?.gap_percent, 0).toFixed(2)}%</td>
                <td className="py-2">{toNumber(row?.relative_volume, 0).toFixed(2)}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Open Market Radar"
          subtitle="Live Class A/B/C setup stream from the radar engine."
        />
      </Card>

      <Card>
        <button
          type="button"
          onClick={loadRadar}
          className="rounded border border-[var(--border-default)] px-3 py-2 text-sm"
          style={{ background: 'var(--bg-elevated)' }}
        >
          Refresh Radar
        </button>
      </Card>

      {loading ? (
        <Card>
          <LoadingSpinner message="Loading radar setups..." />
        </Card>
      ) : null}

      {!loading && error ? (
        <Card>
          <div style={{ color: 'var(--accent-red)' }}>{error}</div>
        </Card>
      ) : null}

      {!loading && !error ? (
        <div className="space-y-3">
          <Card>
            <h3 className="m-0 mb-3">Class A setups</h3>
            {renderRows(classA)}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Class B setups</h3>
            {renderRows(classB)}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Class C setups</h3>
            {renderRows(classC)}
          </Card>
        </div>
      ) : null}
    </PageContainer>
  );
}
