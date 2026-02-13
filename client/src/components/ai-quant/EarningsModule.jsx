import { useState, useEffect, useMemo } from 'react';
import { computeEarningsMomentumScore, getScoreColor, fmtVol, applyGlobalFilters } from './scoring';
import ScoreBreakdown from './ScoreBreakdown';
import { ConfidenceTierBadge, DataQualityDot } from './ConfirmationBadges';

export default function EarningsModule({ onSelectTicker, filters, selected, onToggleSelect, onDataReady, watchlist }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('score');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const today = new Date();
    const from = today.toISOString().split('T')[0];
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() + 5);
    const to = toDate.toISOString().split('T')[0];

    fetch(`/api/earnings/calendar?from=${from}&to=${to}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(async (resp) => {
        if (cancelled) return;
        const calendar = Array.isArray(resp) ? resp : (resp.earnings || []);
        const entries = calendar.filter(e => e.symbol).slice(0, 120);

        const enriched = [];
        for (let i = 0; i < entries.length; i += 8) {
          const batch = entries.slice(i, i + 8);
          const results = await Promise.allSettled(
            batch.map(e =>
              fetch(`/api/yahoo/options?t=${e.symbol}`)
                .then(r => r.ok ? r.json() : null)
            )
          );
          batch.forEach((e, j) => {
            const opts = results[j]?.status === 'fulfilled' ? results[j].value : null;
            enriched.push({
              ticker: e.symbol,
              date: e.date || from,
              hour: e.hour || '',
              epsEstimate: e.epsEstimate ?? null,
              epsActual: e.epsActual ?? null,
              revenueEstimate: e.revenueEstimate ?? null,
              revenueActual: e.revenueActual ?? null,
              surprise: e.surprisePercent ?? null,
              beatsInLast4: e.beatsInLast4 ?? null,
              expectedMovePercent: opts?.expectedMovePercent ?? null,
              expectedMove: opts?.expectedMove ?? null,
              avgIV: opts?.avgIV ?? null,
              avgVolume: e.avgVolume || opts?.avgVolume || null,
              price: opts?.price || e.price || null,
              marketCap: opts?.marketCap || e.marketCap || null,
            });
          });
        }

        const scored = enriched.map(row => {
          const result = computeEarningsMomentumScore(row);
          return { ...row, score: result.score, breakdown: result.breakdown, dataQuality: result.dataQuality };
        });

        setData(scored);
        onDataReady?.('earnings', scored);
        setError(null);
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [onDataReady]);

  const filtered = useMemo(() => applyGlobalFilters(data, filters), [data, filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity, bv = b[sortKey] ?? -Infinity;
      return sortAsc ? av - bv : bv - av;
    });
    return arr;
  }, [filtered, sortKey, sortAsc]);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortHeader = ({ k, label }) => (
    <th onClick={() => handleSort(k)} className="aiq-th aiq-th--sortable">
      {label} {sortKey === k ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  );

  if (loading) return <div className="aiq-module-loading">Scanning earnings candidates…</div>;
  if (error) return <div className="aiq-module-error">Error: {error}</div>;
  if (!data.length) return <div className="aiq-module-empty">No upcoming earnings found.</div>;

  return (
    <div className="aiq-module">
      <div className="aiq-module__bar">
        <span className="aiq-module__universe">📅 Universe: Earnings Calendar · Next 5 Days · Options-Enriched</span>
        <span className="aiq-module__count">{sorted.length} / {data.length}</span>
      </div>
      <div className="aiq-table-wrap">
        <table className="aiq-table">
          <thead>
            <tr>
              <th className="aiq-th aiq-th--check"><input type="checkbox" onChange={e => sorted.forEach(r => onToggleSelect?.(r.ticker, e.target.checked))} /></th>
              <SortHeader k="score" label="Score" />
              <th className="aiq-th">Ticker</th>
              <th className="aiq-th">Date</th>
              <SortHeader k="expectedMovePercent" label="Exp Move%" />
              <SortHeader k="price" label="Price" />
              <th className="aiq-th">EPS Est</th>
              <th className="aiq-th">EPS Act</th>
              <SortHeader k="surprise" label="Surprise%" />
              <SortHeader k="beatsInLast4" label="Beats/4" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.ticker} className={`aiq-row ${selected?.has(row.ticker) ? 'aiq-row--selected' : ''}`}
                onClick={() => onSelectTicker?.(row.ticker)}>
                <td className="aiq-td--check" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected?.has(row.ticker) || false} onChange={() => onToggleSelect?.(row.ticker)} />
                </td>
                <td className="aiq-td--score">
                  <span className="aiq-score-pill" style={{ background: getScoreColor(row.score) + '22', color: getScoreColor(row.score), borderColor: getScoreColor(row.score) }}>
                    {row.score}
                  </span>
                  <ConfidenceTierBadge tier={row.confidenceTier} />
                  <DataQualityDot quality={row.dataQuality} />
                  <ScoreBreakdown breakdown={row.breakdown} score={row.score} />
                </td>
                <td className="aiq-td--ticker">
                  {watchlist?.has(row.ticker) && <span className="aiq-wl-dot" title="In watchlist">★</span>}
                  {row.ticker}
                </td>
                <td className="aiq-td--date">{row.date} {row.hour === 'bmo' ? '🌅' : row.hour === 'amc' ? '🌙' : ''}</td>
                <td style={{ color: row.expectedMovePercent != null && row.expectedMovePercent > 5 ? 'var(--accent-orange)' : undefined }}>
                  {row.expectedMovePercent != null ? `±${row.expectedMovePercent.toFixed(1)}%` : '—'}
                </td>
                <td>{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</td>
                <td>{row.epsEstimate != null ? row.epsEstimate.toFixed(2) : '—'}</td>
                <td className={row.epsActual != null && row.epsEstimate != null ? (row.epsActual >= row.epsEstimate ? 'positive' : 'negative') : ''}>
                  {row.epsActual != null ? row.epsActual.toFixed(2) : '—'}
                </td>
                <td className={row.surprise != null ? (row.surprise > 0 ? 'positive' : row.surprise < 0 ? 'negative' : '') : ''}>
                  {row.surprise != null ? `${row.surprise > 0 ? '+' : ''}${row.surprise.toFixed(1)}%` : '—'}
                </td>
                <td>{row.beatsInLast4 != null ? `${row.beatsInLast4}/4` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
