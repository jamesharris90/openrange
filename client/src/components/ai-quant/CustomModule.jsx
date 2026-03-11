import { useState, useEffect, useMemo } from 'react';
import { Star } from 'lucide-react';
import { authFetch } from '../../utils/api';
import { computeCustomScore, normalizeFinvizRow, parsePct, parseVolume, getScoreColor, fmtVol, fmtPct, applyGlobalFilters } from './scoring';
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
  return {
    Ticker: row?.symbol || '',
    Price: Number.isFinite(Number(row?.price)) ? Number(row.price).toFixed(2) : '',
    Change: toPctString(row?.changePercent),
    Gap: toPctString(row?.gapPercent),
    'Rel Volume': Number.isFinite(Number(row?.relativeVolume ?? row?.rvol)) ? Number(row.relativeVolume ?? row.rvol).toFixed(2) : '',
    ATR: Number.isFinite(Number(row?.atr)) ? Number(row.atr).toFixed(2) : '',
    RSI: Number.isFinite(Number(row?.rsi14)) ? Number(row.rsi14).toFixed(0) : '',
    'Avg Volume': Number.isFinite(Number(row?.avgVolume)) ? Number(row.avgVolume) : '',
    Volume: Number.isFinite(Number(row?.volume)) ? Number(row.volume) : '',
    SMA20: Number.isFinite(Number(row?.sma20)) && Number.isFinite(Number(row?.price)) && Number(row.sma20) !== 0
      ? `${(((Number(row.price) - Number(row.sma20)) / Number(row.sma20)) * 100).toFixed(1)}%`
      : '',
    SMA50: Number.isFinite(Number(row?.sma50)) && Number.isFinite(Number(row?.price)) && Number(row.sma50) !== 0
      ? `${(((Number(row.price) - Number(row.sma50)) / Number(row.sma50)) * 100).toFixed(1)}%`
      : '',
  };
}

function applyLightFilterString(rows, filterString) {
  if (!filterString) return rows;
  const tokens = String(filterString)
    .split(',')
    ?.map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  return rows.filter((row) => {
    const change = parsePct(row.Change) ?? 0;
    const rvol = Number.parseFloat(String(row['Rel Volume'] || 0));
    const avgVolume = Number(row['Avg Volume'] || 0);
    const sma20 = parsePct(row.SMA20);
    const sma50 = parsePct(row.SMA50);

    for (const token of tokens) {
      const avgVolMatch = token.match(/^sh_avgvol_o(\d+(?:\.\d+)?)$/);
      if (avgVolMatch) {
        const threshold = Number(avgVolMatch[1]) * 1000;
        if (!(Number.isFinite(avgVolume) && avgVolume >= threshold)) return false;
        continue;
      }

      const relVolMatch = token.match(/^sh_relvol_o(\d+(?:\.\d+)?)$/);
      if (relVolMatch) {
        const threshold = Number(relVolMatch[1]);
        if (!(Number.isFinite(rvol) && rvol >= threshold)) return false;
        continue;
      }

      const changeUpMatch = token.match(/^ta_change_u(\d+(?:\.\d+)?)$/);
      if (changeUpMatch) {
        const threshold = Number(changeUpMatch[1]);
        if (!(Number.isFinite(change) && change >= threshold)) return false;
        continue;
      }

      if (token === 'ta_sma20_pa' && !(sma20 != null && sma20 > 0)) return false;
      if (token === 'ta_sma50_pa' && !(sma50 != null && sma50 > 0)) return false;
    }

    return true;
  });
}

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
    authFetch('/api/v3/screener/technical?limit=1500')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(payload => {
        if (cancelled) return;
        const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
        const finvizLikeRows = applyLightFilterString(rows?.map(mapCanonicalToFinvizRow), filterString);
        const scored = finvizLikeRows.slice(0, 100)?.map(rawRow => {
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
  if (!data?.length) return <div className="aiq-module-empty">No candidates found for this strategy.</div>;

  return (
    <div className="aiq-module">
      <div className="aiq-module__bar">
        <span className="aiq-module__universe">Custom: {customStrategy?.name}</span>
        <span className="aiq-module__count">{sorted.length} / {data?.length}</span>
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
      <div className="aiq-table-wrap overflow-x-auto">
        <table className="aiq-table min-w-[900px]">
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
            {sorted?.map(row => (
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
