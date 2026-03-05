import { useEffect, useMemo, useState } from 'react';
import { LineChart, Newspaper, Zap } from 'lucide-react';
import { apiJSON } from '../../config/api';
import LoadingSpinner from '../shared/LoadingSpinner';
import TradingViewChart from '../shared/TradingViewChart';

const REFRESH_MS = 15000;

function fmtScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(1);
}

function fmtTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString();
}

export default function OpportunityStream({ limit = 50, compact = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [minScore, setMinScore] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!cancelled) setLoading((prev) => prev && rows.length === 0);
      try {
        const payload = await apiJSON('/api/opportunity-stream');
        if (cancelled) return;
        const list = Array.isArray(payload) ? payload : [];
        setRows(limit > 0 ? list.slice(0, limit) : list);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [limit]);

  const data = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);

  const maxScore = useMemo(() => {
    const scores = data
      .map((row) => Number(row?.score))
      .filter((value) => Number.isFinite(value));
    if (!scores.length) return 100;
    return Math.max(100, Math.ceil(Math.max(...scores)));
  }, [data]);

  const filteredData = useMemo(() => {
    return data.filter((row) => {
      const eventType = String(row?.event_type || '').toLowerCase();
      const sourceRaw = String(row?.source || '').toLowerCase();
      const sourceCategory = sourceRaw.includes('strategy')
        ? 'strategy'
        : sourceRaw.includes('catalyst') || sourceRaw.includes('news')
          ? 'news'
          : sourceRaw.includes('metric')
            ? 'metrics'
            : 'other';
      const score = Number(row?.score);

      if (eventTypeFilter !== 'all' && eventType !== eventTypeFilter) return false;
      if (sourceFilter !== 'all' && sourceCategory !== sourceFilter) return false;
      if (Number.isFinite(score) && score < minScore) return false;
      if (!Number.isFinite(score) && minScore > 0) return false;
      return true;
    });
  }, [data, eventTypeFilter, sourceFilter, minScore]);

  function renderEventCell(eventType) {
    const normalized = String(eventType || '').toLowerCase();
    if (normalized === 'setup') return <span className="inline-flex items-center gap-1"><LineChart size={14} /> setup</span>;
    if (normalized === 'catalyst') return <span className="inline-flex items-center gap-1"><Newspaper size={14} /> catalyst</span>;
    if (normalized === 'market') return <span className="inline-flex items-center gap-1"><Zap size={14} /> market</span>;
    return normalized || '--';
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-3">
        <label>
          <div className="muted text-xs">Event Type</div>
          <select className="input-field" value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="setup">setup</option>
            <option value="catalyst">catalyst</option>
            <option value="market">market</option>
          </select>
        </label>

        <label>
          <div className="muted text-xs">Source</div>
          <select className="input-field" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="strategy">strategy</option>
            <option value="news">news</option>
            <option value="metrics">metrics</option>
          </select>
        </label>

        <label>
          <div className="muted text-xs">Minimum Score: {minScore}</div>
          <input
            type="range"
            min="0"
            max={String(maxScore)}
            value={String(minScore)}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-full"
          />
        </label>
      </div>

      {loading && data.length === 0 ? (
        <LoadingSpinner message="Loading opportunity stream…" />
      ) : filteredData.length === 0 ? (
        <div className="muted">No active opportunities detected</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table data-table--compact min-w-[740px]">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Event</th>
                <th>Headline</th>
                <th style={{ textAlign: 'right' }}>Score</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row) => {
                const symbol = String(row?.symbol || '').toUpperCase();
                return (
                  <tr
                    key={row?.id || `${symbol}-${row?.event_type}-${row?.created_at}`}
                    onClick={() => symbol && setSelectedSymbol(symbol)}
                    style={{ cursor: symbol ? 'pointer' : 'default' }}
                  >
                    <td>{symbol || '--'}</td>
                    <td>{renderEventCell(row?.event_type)}</td>
                    <td>{row?.headline || '--'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtScore(row?.score)}</td>
                    <td>{fmtTime(row?.created_at || row?.timestamp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!compact && selectedSymbol && (
        <div>
          <div className="muted" style={{ marginBottom: 6 }}>Chart: {selectedSymbol}</div>
          <TradingViewChart symbol={selectedSymbol} height={280} interval="15" range="5D" hideSideToolbar />
        </div>
      )}
    </div>
  );
}
