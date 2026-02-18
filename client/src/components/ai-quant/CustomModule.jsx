import { useState, useEffect, useMemo } from 'react';
import { Star } from 'lucide-react';
import { computeCustomScore, normalizeFinvizRow, parsePct, parseVolume, getScoreColor, fmtVol, fmtPct, applyGlobalFilters } from './scoring';
import ExportButtons from '../shared/ExportButtons';
import ScoreBreakdown from './ScoreBreakdown';
import { ConfidenceTierBadge, DataQualityDot } from './ConfirmationBadges';

export default function CustomModule({ strategyId, onSelectTicker, filters, selected, onToggleSelect, onDataReady, watchlist, customStrategy }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('score');
  const [sortAsc, setSortAsc] = useState(false);

  const filterString = customStrategy?.filterString || '';
  const weights = customStrategy?.weights || { gapChange: 25, volume: 25, technical: 25, proximity: 25 };

  useEffect(() => {
    if (!filterString) { setLoading(false); setData([]); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/finviz/screener?f=${encodeURIComponent(filterString)}&v=152&c=0,1,2,3,4,5,6,7,8,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(rows => {
        if (cancelled) return;
        const scored = (rows || []).slice(0, 100).map(rawRow => {
          const row = normalizeFinvizRow(rawRow);
          const result = computeCustomScore(row, weights);
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
        onDataReady?.(strategyId, scored);
        setError(null);
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filterString, strategyId, onDataReady]); // weights intentionally excluded to avoid refetch loops

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

  if (loading) return <div className="aiq-module-loading">Scanning {customStrategy?.name || 'custom'} candidates…</div>;
  if (error) return <div className="aiq-module-error">Error: {error}</div>;
  if (!data.length) return <div className="aiq-module-empty">No candidates found for this strategy.</div>;

  return (
    <div className="aiq-module">
      <div className="aiq-module__bar">
        <span className="aiq-module__universe">Custom: {customStrategy?.name}</span>
        <span className="aiq-module__count">{sorted.length} / {data.length}</span>
      </div>
      <ExportButtons
        data={sorted}
        columns={[
          { key: 'ticker', label: 'Ticker' },
          { key: 'score', label: 'Score' },
          { key: 'price', label: 'Price' },
          { key: 'gap', label: 'Gap%', accessor: r => r.gap != null ? `${r.gap.toFixed(2)}%` : '' },
          { key: 'change', label: 'Change%', accessor: r => r.change != null ? `${r.change.toFixed(2)}%` : '' },
          { key: 'rvol', label: 'RVOL', accessor: r => r.rvol?.toFixed(2) || '' },
          { key: 'rsi', label: 'RSI', accessor: r => r.rsi?.toFixed(0) || '' },
        ]}
        filename={`custom-${strategyId}`}
      />
      <div className="aiq-table-wrap">
        <table className="aiq-table">
          <thead>
            <tr>
              <th className="aiq-th" style={{ width: 40 }}></th>
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
                <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                  <button
                    className={`btn-icon${watchlist?.has(row.ticker) ? ' active' : ''}`}
                    title={watchlist?.has(row.ticker) ? 'Remove from watchlist' : 'Add to watchlist'}
                    onClick={() => watchlist?.has(row.ticker) ? watchlist.remove(row.ticker) : watchlist?.add(row.ticker, 'ai-quant')}
                  >
                    <Star size={16} />
                  </button>
                </td>
                <td className="aiq-td--score">
                  <span className="aiq-score-pill" style={{ background: getScoreColor(row.score) + '22', color: getScoreColor(row.score), borderColor: getScoreColor(row.score) }}>
                    {row.score}
                  </span>
                  <ConfidenceTierBadge tier={row.confidenceTier} />
                  <DataQualityDot quality={row.dataQuality} />
                  <ScoreBreakdown breakdown={row.breakdown} score={row.score} />
                </td>
                <td className="aiq-td--ticker">{row.ticker}</td>
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
