import { useEffect, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';

function fmt(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

function findExpectedMoveRow(payload, symbol) {
  const upper = String(symbol || '').toUpperCase();
  if (Array.isArray(payload)) {
    return payload.find((row) => String(row?.symbol || row?.ticker || '').toUpperCase() === upper) || null;
  }
  if (payload && typeof payload === 'object') return payload;
  return null;
}

export default function ExpectedMovePage() {
  const [input, setInput] = useState('');
  const [symbol, setSymbol] = useState('');
  const [row, setRow] = useState(null);
  const [rules, setRules] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadRules() {
      try {
        const payload = await apiJSON('/api/scoring-rules');
        if (!cancelled) setRules(payload || null);
      } catch {
        if (!cancelled) setRules(null);
      }
    }

    loadRules();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalized = String(input || '').trim().toUpperCase();
    if (!normalized) return;

    setLoading(true);
    setError('');
    setRow(null);

    try {
      const payload = await apiJSON(`/api/expected-move?symbol=${encodeURIComponent(normalized)}`);
      const matched = findExpectedMoveRow(payload, normalized);
      if (!matched) {
        setError(`No expected move data found for ${normalized}.`);
      } else {
        setSymbol(normalized);
        setRow(matched);
      }
    } catch (err) {
      setError(err?.message || 'Failed to load expected move data');
    } finally {
      setLoading(false);
    }
  };

  const scoringBreakdown = useMemo(() => {
    if (!row) return null;
    return row?.scoring_breakdown || row?.scoring || null;
  }, [row]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Expected Move"
          subtitle="Ticker-driven expected move view with scoring breakdown from intelligence rules."
        />
        <form onSubmit={handleSubmit} className="mt-3 flex items-end gap-2">
          <label className="w-full max-w-[260px]">
            <span className="muted text-sm">Ticker</span>
            <input
              className="input-field"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="Enter ticker"
            />
          </label>
          <button type="submit" className="btn-primary">Analyze</button>
        </form>
      </Card>

      {loading && <LoadingSpinner message="Loading expected move…" />}
      {!loading && error && <Card><div className="muted">{error}</div></Card>}

      {!loading && !error && symbol && !row && (
        <Card>
          <div className="muted">No qualifying setups right now for {symbol}.</div>
        </Card>
      )}

      {!loading && !error && row && (
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <h3 className="m-0 mb-3">Expected Move</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>Symbol</span><strong>{String(row?.symbol || row?.ticker || symbol).toUpperCase()}</strong></div>
              <div className="flex items-center justify-between"><span>Price</span><strong>{fmt(row?.price, 2)}</strong></div>
              <div className="flex items-center justify-between"><span>Expected Move ($)</span><strong>{fmt(row?.expected_move ?? row?.expectedMove, 2)}</strong></div>
              <div className="flex items-center justify-between"><span>Expected Move (%)</span><strong>{fmt(row?.expected_move_percent ?? row?.expectedMovePercent, 2)}%</strong></div>
            </div>
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Scoring Breakdown</h3>
            {scoringBreakdown ? (
              <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(scoringBreakdown, null, 2)}</pre>
            ) : (
              <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ strategy: rules?.strategy || {}, catalyst_scores: rules?.catalyst_scores || {} }, null, 2)}</pre>
            )}
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
