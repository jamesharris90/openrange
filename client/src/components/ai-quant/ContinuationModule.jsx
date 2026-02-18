import { useState, useEffect, useMemo } from 'react';
import { Star } from 'lucide-react';
import { computeContinuationScore, normalizeFinvizRow, parsePct, parseVolume, getScoreColor, fmtVol, fmtPct, applyGlobalFilters } from './scoring';
import ExportButtons from '../shared/ExportButtons';
import ScoreBreakdown from './ScoreBreakdown';
import { ConfidenceTierBadge, DataQualityDot } from './ConfirmationBadges';

export default function ContinuationModule({ onSelectTicker, filters, selected, onToggleSelect, onDataReady, watchlist }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('score');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/finviz/screener?f=ta_sma20_pa,ta_sma50_pa,sh_avgvol_o500&v=152&c=0,1,2,3,4,5,6,7,8,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70&o=-relativevolume')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(rows => {
        if (cancelled) return;
        const scored = (rows || []).slice(0, 100).map(rawRow => {
          const row = normalizeFinvizRow(rawRow);
          const result = computeContinuationScore(row);
          return {
            ...row,
            ticker: row['Ticker'] || '',
            price: parseFloat(row['Price']) || null,
            change: parsePct(row['Change']),
            sma20: parsePct(row['SMA20']),
            sma50: parsePct(row['SMA50']),
            sma200: parsePct(row['SMA200']),
            rvol: parseFloat(row['Rel Volume']) || null,
            rsi: parseFloat(row['RSI']) || null,
            dist52wh: parsePct(row['52W High']),
            dist52wl: parsePct(row['52W Low']),
            beta: parseFloat(row['Beta']) || null,
            avgVolume: parseVolume(row['Avg Volume']),
            score: result.score,
            breakdown: result.breakdown,
            dataQuality: result.dataQuality,
          };
        });
        setData(scored);
        onDataReady?.('continuation', scored);
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

  if (loading) return <div className="aiq-module-loading">Scanning continuation setups…</div>;
  if (error) return <div className="aiq-module-error">Error: {error}</div>;
  if (!data.length) return <div className="aiq-module-empty">No continuation candidates found.</div>;

  return (
    <div className="aiq-module">
      <div className="aiq-module__bar">
        <span className="aiq-module__universe">Continuation Universe: Above 20 &amp; 50 SMA · Avg Vol &gt; 500K</span>
        <span className="aiq-module__count">{sorted.length} / {data.length}</span>
      </div>
      <ExportButtons
        data={sorted}
        columns={[
          { key: 'ticker', label: 'Ticker' },
          { key: 'score', label: 'Score' },
          { key: 'price', label: 'Price', accessor: r => r.price?.toFixed(2) || '' },
          { key: 'change', label: 'Change%', accessor: r => r.change != null ? `${r.change.toFixed(2)}%` : '' },
          { key: 'sma20', label: 'vs 20-SMA', accessor: r => r.sma20 != null ? `${r.sma20.toFixed(1)}%` : '' },
          { key: 'sma50', label: 'vs 50-SMA', accessor: r => r.sma50 != null ? `${r.sma50.toFixed(1)}%` : '' },
          { key: 'rsi', label: 'RSI', accessor: r => r.rsi?.toFixed(0) || '' },
          { key: 'rvol', label: 'RVOL', accessor: r => r.rvol?.toFixed(2) || '' },
        ]}
        filename="continuation-scanner"
      />
      <div className="aiq-table-wrap">
        <table className="aiq-table">
          <thead>
            <tr>
              <th className="aiq-th" style={{ width: 40 }}></th>
              <SortHeader k="score" label="Score" />
              <th className="aiq-th">Ticker</th>
              <SortHeader k="price" label="Price" />
              <SortHeader k="change" label="Chg%" />
              <SortHeader k="sma20" label="vs 20-SMA" />
              <SortHeader k="sma50" label="vs 50-SMA" />
              <SortHeader k="rsi" label="RSI" />
              <SortHeader k="rvol" label="RVOL" />
              <SortHeader k="dist52wh" label="vs 52W-H" />
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
                <td className="aiq-td--score" data-tooltip="Continuation Score: SMA + RVOL + RSI + Volume (0-100)">
                  <span className="aiq-score-pill" style={{ background: getScoreColor(row.score) + '22', color: getScoreColor(row.score), borderColor: getScoreColor(row.score) }}>
                    {row.score}
                  </span>
                  <ConfidenceTierBadge tier={row.confidenceTier} />
                  <DataQualityDot quality={row.dataQuality} />
                  <ScoreBreakdown breakdown={row.breakdown} score={row.score} />
                </td>
                <td className="aiq-td--ticker">
                  {row.ticker}
                </td>
                <td>{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</td>
                <td className={row.change != null ? (row.change >= 0 ? 'positive' : 'negative') : ''}>{fmtPct(row.change)}</td>
                <td className={row.sma20 != null && row.sma20 > 0 ? 'positive' : ''}>{fmtPct(row.sma20, 1)}</td>
                <td className={row.sma50 != null && row.sma50 > 0 ? 'positive' : ''}>{fmtPct(row.sma50, 1)}</td>
                <td style={{ color: row.rsi != null && row.rsi > 65 ? 'var(--accent-orange)' : undefined }}>{row.rsi != null ? row.rsi.toFixed(0) : '—'}</td>
                <td style={{ color: row.rvol != null && row.rvol >= 1.5 ? 'var(--accent-green)' : undefined }}>{row.rvol != null ? row.rvol.toFixed(2) : '—'}</td>
                <td>{row.dist52wh != null ? `${row.dist52wh.toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
