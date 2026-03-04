import { useState, useEffect, useMemo } from 'react';
import { Star } from 'lucide-react';
import { authFetch } from '../../utils/api';
import { apiJSON } from '@/config/api';
import { computeEarningsMomentumScore, getScoreColor, fmtVol, applyGlobalFilters } from './scoring';
import ExportButtons from '../shared/ExportButtons';
import ScoreBreakdown from './ScoreBreakdown';
import { ConfidenceTierBadge, DataQualityDot } from './ConfirmationBadges';

export default function EarningsModule({ onSelectTicker, filters, selected, onToggleSelect, onDataReady, watchlist, strategyFilter }) {
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
    toDate.setDate(toDate.getDate() + 14);
    const to = toDate.toISOString().split('T')[0];

    apiJSON(`/api/earnings/calendar?from=${from}&to=${to}`)
      .then(async (resp) => {
        if (cancelled) return;
        const calendar = Array.isArray(resp) ? resp : (resp.earnings || []);
        const entries = calendar.filter(e => e.symbol).slice(0, 120);

        const symbolList = Array.from(new Set(entries.map((entry) => String(entry.symbol || '').trim().toUpperCase()).filter(Boolean)));
        let technicalBySymbol = {};
        try {
          const techResp = await authFetch('/api/v3/screener/technical?limit=3000');
          if (techResp.ok) {
            const techPayload = await techResp.json();
            const techRows = Array.isArray(techPayload?.data) ? techPayload.data : (Array.isArray(techPayload) ? techPayload : []);
            const needed = new Set(symbolList);
            technicalBySymbol = techRows.reduce((acc, row) => {
              const symbol = String(row?.symbol || '').toUpperCase();
              if (symbol && needed.has(symbol)) acc[symbol] = row;
              return acc;
            }, {});
          }
        } catch {
          technicalBySymbol = {};
        }

        const enriched = [];
        for (let i = 0; i < entries.length; i += 8) {
          const batch = entries.slice(i, i + 8);
          const results = await Promise.allSettled(
            batch.map(e =>
              authFetch(`/api/options/expected-move/${encodeURIComponent(e.symbol)}`)
                .then(r => r.ok ? r.json() : null)
            )
          );
          batch.forEach((e, j) => {
            const optsPayload = results[j]?.status === 'fulfilled' ? results[j].value : null;
            const opts = optsPayload?.data || null;
            const tech = technicalBySymbol[String(e.symbol || '').toUpperCase()] || null;

            const impliedMovePct = Number(opts?.impliedMovePct);
            const expectedMovePercent = Number.isFinite(impliedMovePct)
              ? (Math.abs(impliedMovePct) <= 1 ? impliedMovePct * 100 : impliedMovePct)
              : null;

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
              rvol: e.rvol ?? tech?.rvol ?? null,
              expectedMovePercent,
              expectedMove: Number(opts?.impliedMoveDollar) || null,
              avgIV: Number(opts?.iv) || null,
              avgVolume: e.avgVolume || tech?.avgVolume || null,
              price: e.price || tech?.price || null,
              marketCap: e.marketCap || tech?.marketCap || null,
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

  const strategyFiltered = useMemo(
    () => strategyFilter ? filtered.filter(strategyFilter) : filtered,
    [filtered, strategyFilter]
  );

  const sorted = useMemo(() => {
    const arr = [...strategyFiltered];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity, bv = b[sortKey] ?? -Infinity;
      return sortAsc ? av - bv : bv - av;
    });
    return arr;
  }, [strategyFiltered, sortKey, sortAsc]);

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
  if (error) return (
    <div className="aiq-module-error">
      <div>Could not load earnings data.</div>
      <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>{error}</div>
    </div>
  );
  if (!data.length) return (
    <div className="aiq-module-empty">
      <div>No earnings events found for the next 14 days.</div>
      <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>Data requires FMP_API_KEY or a populated earnings_events database table.</div>
    </div>
  );

  return (
    <div className="aiq-module">
      <div className="aiq-module__bar">
        <span className="aiq-module__universe">📅 Universe: Earnings Calendar · Next 14 Days · Options-Enriched</span>
        <span className="aiq-module__count">{sorted.length} / {data.length}</span>
      </div>
      <ExportButtons
        data={sorted}
        columns={[
          { key: 'ticker', label: 'Ticker' },
          { key: 'score', label: 'Score' },
          { key: 'date', label: 'Date' },
          { key: 'expectedMovePercent', label: 'Exp Move%', accessor: r => r.expectedMovePercent != null ? `±${r.expectedMovePercent.toFixed(1)}%` : '' },
          { key: 'price', label: 'Price', accessor: r => r.price?.toFixed(2) || '' },
          { key: 'epsEstimate', label: 'EPS Est', accessor: r => r.epsEstimate?.toFixed(2) || '' },
          { key: 'epsActual', label: 'EPS Act', accessor: r => r.epsActual?.toFixed(2) || '' },
          { key: 'surprise', label: 'Surprise%', accessor: r => r.surprise != null ? `${r.surprise.toFixed(1)}%` : '' },
        ]}
        filename="earnings-scanner"
      />
      <div className="aiq-table-wrap overflow-x-auto">
        <table className="aiq-table min-w-[900px]">
          <thead>
            <tr>
              <th className="aiq-th" style={{ width: 40 }}></th>
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
                <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                  <button
                    className={`btn-icon${watchlist?.has(row.ticker) ? ' active' : ''}`}
                    title={watchlist?.has(row.ticker) ? 'Remove from watchlist' : 'Add to watchlist'}
                    onClick={() => watchlist?.has(row.ticker) ? watchlist.remove(row.ticker) : watchlist?.add(row.ticker, 'ai-quant')}
                  >
                    <Star size={16} />
                  </button>
                </td>
                <td className="aiq-td--score" data-tooltip="Earnings Momentum Score (0-100)">
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
