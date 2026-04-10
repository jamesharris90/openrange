import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../../lib/apiClient';

function formatValue(value, suffix = '') {
  if (value === null || value === undefined || value === '') return 'Data unavailable';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}${suffix}`;
  }
  return String(value);
}

function authHeaders() {
  const token = localStorage.getItem('openrange_token') || localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function DecisionCard({ symbol }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [decision, setDecision] = useState(null);

  useEffect(() => {
    const activeSymbol = String(symbol || '').trim().toUpperCase();
    if (!activeSymbol) {
      setDecision(null);
      return;
    }

    let cancelled = false;

    async function loadDecision() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE}/api/intelligence/decision/${encodeURIComponent(activeSymbol)}`, {
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            ...authHeaders(),
          },
        });

        if (!response.ok) {
          throw new Error(`Decision API error: ${response.status}`);
        }

        const payload = await response.json();
        if (!cancelled) {
          setDecision(payload?.decision || null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load intelligence decision');
          setDecision(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDecision();

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const titleSymbol = useMemo(() => String(symbol || '').trim().toUpperCase() || '---', [symbol]);

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{titleSymbol}</h3>
        <span className="text-xs text-[var(--text-muted)]">Decision Layer</span>
      </div>

      {loading ? <div className="text-sm">Loading decision intelligence...</div> : null}
      {!loading && error ? <div className="text-sm text-rose-400">{error}</div> : null}

      {!loading && !error ? (
        <div className="space-y-2 text-sm">
          <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
            <div className="text-xs text-[var(--text-muted)]">Why it&apos;s moving</div>
            <div>🔥 Catalyst: {formatValue(decision?.why_moving?.catalyst)}</div>
            <div>Type: {formatValue(decision?.why_moving?.catalyst_type)}</div>
            <div>Narrative: {formatValue(decision?.why_moving?.narrative)}</div>
          </div>

          <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
            <div className="text-xs text-[var(--text-muted)]">Tradeability</div>
            <div>📊 RVOL: {formatValue(decision?.tradeability?.rvol)}</div>
            <div>Range: {formatValue(decision?.tradeability?.range_pct, '%')}</div>
            <div>Liquidity Score: {formatValue(decision?.tradeability?.liquidity_score)}</div>
          </div>

          <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
            <div className="text-xs text-[var(--text-muted)]">Best Strategy</div>
            <div>🎯 Strategy: {formatValue(decision?.execution_plan?.strategy)}</div>
            <div>Entry: {formatValue(decision?.execution_plan?.entry_type)}</div>
            <div>Risk: {formatValue(decision?.execution_plan?.risk_level)}</div>
            <div>Win Probability: {formatValue(decision?.execution_plan?.win_probability, '%')}</div>
          </div>

          <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 font-semibold">
            📈 Confidence Score: {formatValue(decision?.decision_score)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
