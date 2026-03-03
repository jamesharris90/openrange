import { useState, useEffect, useMemo } from 'react';
import { Star } from 'lucide-react';
import { authFetch } from '../../utils/api';
import { computeContinuationScore, normalizeFinvizRow, parsePct, parseVolume, getScoreColor, fmtVol, fmtPct, applyGlobalFilters } from './scoring';
import ExportButtons from '../shared/ExportButtons';
import ScoreBreakdown from './ScoreBreakdown';
import { ConfidenceTierBadge, DataQualityDot } from './ConfirmationBadges';

function toPctString(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct.toFixed(digits)}%`;
}

function mapCanonicalToFinvizRow(row) {
  const price = Number(row?.price);
  const sma20 = Number(row?.sma20);
  const sma50 = Number(row?.sma50);
  const sma200 = Number(row?.sma200);

  const sma20Pct = Number.isFinite(price) && Number.isFinite(sma20) && sma20 !== 0 ? ((price - sma20) / sma20) * 100 : null;
  const sma50Pct = Number.isFinite(price) && Number.isFinite(sma50) && sma50 !== 0 ? ((price - sma50) / sma50) * 100 : null;
  const sma200Pct = Number.isFinite(price) && Number.isFinite(sma200) && sma200 !== 0 ? ((price - sma200) / sma200) * 100 : null;

  return {
    Ticker: row?.symbol || '',
    Price: Number.isFinite(price) ? price.toFixed(2) : '',
    Change: toPctString(row?.changePercent),
    SMA20: toPctString(sma20Pct),
    SMA50: toPctString(sma50Pct),
    SMA200: toPctString(sma200Pct),
    'Rel Volume': Number.isFinite(Number(row?.relativeVolume ?? row?.rvol)) ? Number(row.relativeVolume ?? row.rvol).toFixed(2) : '',
    RSI: Number.isFinite(Number(row?.rsi14)) ? Number(row.rsi14).toFixed(0) : '',
    '52W High': Number.isFinite(Number(row?.high52Week)) && Number.isFinite(price) && Number(row.high52Week) !== 0
      ? `${(((price - Number(row.high52Week)) / Number(row.high52Week)) * 100).toFixed(1)}%`
      : '',
    Beta: Number.isFinite(Number(row?.beta)) ? Number(row.beta).toFixed(2) : '',
    'Avg Volume': Number.isFinite(Number(row?.avgVolume)) ? Number(row.avgVolume) : '',
  };
}

export default function ContinuationModule({ onSelectTicker, filters, selected, onToggleSelect, onDataReady, watchlist }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('score');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    authFetch('/api/v3/screener/technical?limit=500&volumeMin=500000')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(payload => {
        if (cancelled) return;
        const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
        const scored = rows
          .map(mapCanonicalToFinvizRow)
          .filter((rawRow) => {
            const s20 = parsePct(rawRow.SMA20);
            const s50 = parsePct(rawRow.SMA50);
            return s20 != null && s20 > 0 && s50 != null && s50 > 0;
          })
          .slice(0, 100)
          .map(rawRow => {
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
      <div className="aiq-table-wrap overflow-x-auto">
        <table className="aiq-table min-w-[900px]">
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
