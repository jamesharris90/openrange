import { useState, useEffect, useMemo } from 'react';
import { computeORBScore, normalizeFinvizRow, parsePct, parseVolume, getScoreColor, fmtVol, fmtPct, applyGlobalFilters } from './scoring';
import ScoreBreakdown from './ScoreBreakdown';
import { ConfidenceTierBadge, DataQualityDot } from './ConfirmationBadges';

export default function ORBModule({ onSelectTicker, filters, selected, onToggleSelect, onDataReady, watchlist }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('score');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/finviz/screener?f=sh_avgvol_o500,ta_change_u3&v=152&c=0,1,2,3,4,5,6,7,8,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(rows => {
        if (cancelled) return;
        const scored = (rows || []).slice(0, 100).map(rawRow => {
          const row = normalizeFinvizRow(rawRow);
          const result = computeORBScore(row);
          return {
            ...row,
            ticker: row['Ticker'] || '',
            price: parseFloat(row['Price']) || null,
            change: parsePct(row['Change']),
            gap: parsePct(row['Gap']),
            rvol: parseFloat(row['Rel Volume']) || null,
            atr: parseFloat(row['ATR']) || null,
            rsi: parseFloat(row['RSI']) || null,
            avgVolume: parseVolume(row['Avg Volume']),
            volume: parseVolume(row['Volume']),
            score: result.score,
            breakdown: result.breakdown,
            dataQuality: result.dataQuality,
          };
        });
        setData(scored);
        onDataReady?.('orb', scored);
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

  if (loading) return <div className="aiq-module-loading">Scanning ORB candidates…</div>;
  if (error) return <div className="aiq-module-error">Error: {error}</div>;
  if (!data.length) return <div className="aiq-module-empty">No ORB candidates found. Markets may be closed.</div>;

  return (
    <div className="aiq-module">
      <div className="aiq-module__bar">
        <span className="aiq-module__universe">📡 Universe: Finviz Gappers · Avg Vol &gt; 500K · Change &gt; 3%</span>
        <span className="aiq-module__count">{sorted.length} / {data.length}</span>
      </div>
      <div className="aiq-table-wrap">
        <table className="aiq-table">
          <thead>
            <tr>
              <th className="aiq-th aiq-th--check"><input type="checkbox" onChange={e => sorted.forEach(r => onToggleSelect?.(r.ticker, e.target.checked))} /></th>
              <SortHeader k="score" label="Score" />
              <th className="aiq-th">Ticker</th>
              <SortHeader k="price" label="Price" />
              <SortHeader k="gap" label="Gap%" />
              <SortHeader k="change" label="Chg%" />
              <SortHeader k="rvol" label="RVOL" />
              <SortHeader k="atr" label="ATR" />
              <SortHeader k="rsi" label="RSI" />
              <SortHeader k="avgVolume" label="Avg Vol" />
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
                <td>{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</td>
                <td className={row.gap != null ? (row.gap >= 0 ? 'positive' : 'negative') : ''}>{fmtPct(row.gap)}</td>
                <td className={row.change != null ? (row.change >= 0 ? 'positive' : 'negative') : ''}>{fmtPct(row.change)}</td>
                <td style={{ color: row.rvol != null && row.rvol >= 2 ? 'var(--accent-green)' : undefined }}>{row.rvol != null ? row.rvol.toFixed(2) : '—'}</td>
                <td>{row.atr != null ? row.atr.toFixed(2) : '—'}</td>
                <td style={{ color: row.rsi != null && row.rsi > 70 ? 'var(--accent-red)' : row.rsi != null && row.rsi < 30 ? 'var(--accent-green)' : undefined }}>{row.rsi != null ? row.rsi.toFixed(0) : '—'}</td>
                <td>{fmtVol(row.avgVolume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
