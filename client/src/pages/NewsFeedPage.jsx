/**
 * NewsFeedPage — freshness-sorted news articles from the database.
 * Calls /api/news/latest — no auth required.
 * Auto-refreshes every 60 seconds.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../utils/api';

const REFRESH_MS   = 60_000;
const DEFAULT_LIMIT = 100;

// ── helpers ──────────────────────────────────────────────────────────────────

function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60_000)         return 'just now';
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function sourceTag(source) {
  if (!source) return null;
  const clean = String(source).trim().replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '');
  return clean.length > 24 ? clean.slice(0, 22) + '…' : clean;
}

const pct = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return { text: `${v > 0 ? '+' : ''}${v.toFixed(2)}%`, pos: v >= 0 };
};

// ── sub-components ────────────────────────────────────────────────────────────

function SymbolBadge({ symbol }) {
  if (!symbol) return null;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 4,
      background: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)',
      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
      marginRight: 6, flexShrink: 0,
    }}>
      {symbol}
    </span>
  );
}

function NewsRow({ item, index }) {
  const change = pct(item.change_percent ?? item.changePercent);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '9px 14px',
        borderBottom: '1px solid var(--border-color)',
        background: index % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card-hover)'}
      onMouseLeave={(e) => e.currentTarget.style.background = index % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'}
    >
      {/* Time column */}
      <div style={{ width: 54, flexShrink: 0, paddingTop: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(item.published_at)}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
          {timeAgo(item.published_at)}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 3 }}>
          <SymbolBadge symbol={item.symbol} />
          {change && (
            <span style={{ fontSize: 11, fontWeight: 600, color: change.pos ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              {change.text}
            </span>
          )}
        </div>

        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 13, color: 'var(--text-primary)', textDecoration: 'none',
              lineHeight: '1.4', display: 'block',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-blue)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
          >
            {item.headline || item.title}
          </a>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: '1.4' }}>
            {item.headline || item.title}
          </div>
        )}

        {item.summary && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, lineHeight: '1.4',
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {item.summary}
          </div>
        )}
      </div>

      {/* Source */}
      <div style={{ width: 90, flexShrink: 0, paddingTop: 1, textAlign: 'right' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {sourceTag(item.source || item.provider)}
        </span>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function NewsFeedPage() {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [symbol,  setSymbol]  = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const abortRef = useRef(null);
  const timerRef = useRef(null);

  const fetchNews = useCallback(async (sym) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    const params = new URLSearchParams({ limit: DEFAULT_LIMIT });
    if (sym) params.set('symbol', sym.trim().toUpperCase());

    try {
      setLoading(true);
      setError(null);
      const res = await authFetch(`/api/news/latest?${params}`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows = Array.isArray(json) ? json : (json?.data || json?.rows || []);
      setItems(rows);
      setLastUpdated(new Date());
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + auto-refresh
  useEffect(() => {
    fetchNews(symbol);
    timerRef.current = setInterval(() => fetchNews(symbol), REFRESH_MS);
    return () => {
      clearInterval(timerRef.current);
      abortRef.current?.abort();
    };
  }, [fetchNews, symbol]);

  const handleSymbolSearch = (e) => {
    e.preventDefault();
    const v = e.target.elements.symbol.value.trim().toUpperCase();
    setSymbol(v);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            News Feed
          </h1>
          {items.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {items.length} articles
            </span>
          )}
        </div>

        {/* Symbol search */}
        <form onSubmit={handleSymbolSearch} style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <input
            name="symbol"
            placeholder="Filter by symbol…"
            defaultValue={symbol}
            style={{
              padding: '4px 8px', borderRadius: 5, fontSize: 12,
              background: 'var(--bg-input)', border: '1px solid var(--border-color)',
              color: 'var(--text-primary)', outline: 'none', width: 150,
            }}
          />
          {symbol && (
            <button
              type="button"
              onClick={() => setSymbol('')}
              style={{
                padding: '3px 8px', borderRadius: 4, fontSize: 11,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </form>

        {/* Status */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
          {loading && 'Loading…'}
          {!loading && lastUpdated && `Updated ${timeAgo(lastUpdated.toISOString())}`}
        </div>

        <button
          onClick={() => fetchNews(symbol)}
          disabled={loading}
          style={{
            padding: '4px 10px', borderRadius: 5, fontSize: 11,
            background: 'var(--accent-blue)', color: '#fff', border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
            flexShrink: 0,
          }}
        >
          Refresh
        </button>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {error && (
          <div style={{ padding: 16, color: 'var(--accent-red)', fontSize: 13 }}>
            Error: {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            No news articles found.
            {symbol && ` No results for "${symbol}".`}
          </div>
        )}

        {items.map((item, i) => (
          <NewsRow key={item.id || `${item.symbol}-${i}`} item={item} index={i} />
        ))}
      </div>
    </div>
  );
}
