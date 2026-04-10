/**
 * IpoCalendarPage — Yahoo Finance-style week-by-week IPO calendar.
 * Data from /api/ipo/calendar?weekOffset=0
 */
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../utils/api';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtShares(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function fmtPriceRange(low, high) {
  if (low == null && high == null) return null;
  if (low != null && high != null) return `$${Number(low).toFixed(2)}–$${Number(high).toFixed(2)}`;
  if (high != null) return `$${Number(high).toFixed(2)}`;
  return `$${Number(low).toFixed(2)}`;
}

function statusColor(status) {
  if (!status) return null;
  const s = String(status).toLowerCase();
  if (s.includes('price') || s.includes('listed') || s.includes('filed')) return 'var(--accent-green)';
  if (s.includes('withdraw') || s.includes('cancel')) return 'var(--accent-red)';
  return 'var(--accent-blue)';
}

// ── IpoEvent card ─────────────────────────────────────────────────────────────

function EventCard({ event }) {
  const priceRange = fmtPriceRange(event.priceRangeLow, event.priceRangeHigh);
  const sc = statusColor(event.status);

  return (
    <div style={{
      padding: '6px 8px',
      borderRadius: 5,
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-color)',
      marginBottom: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
        <span style={{
          fontWeight: 700, fontSize: 12, color: 'var(--accent-blue)',
          letterSpacing: '0.04em',
        }}>
          {event.symbol || '—'}
        </span>
        {event.exchange && (
          <span style={{
            fontSize: 9, fontWeight: 600, padding: '1px 4px', borderRadius: 3,
            background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)',
            letterSpacing: '0.04em',
          }}>
            {event.exchange}
          </span>
        )}
        {event.status && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
            background: sc ? `${sc}22` : 'rgba(255,255,255,0.06)',
            color: sc || 'var(--text-muted)',
            letterSpacing: '0.04em', marginLeft: 'auto',
          }}>
            {event.status}
          </span>
        )}
      </div>

      {event.companyName && (
        <div style={{
          fontSize: 10, color: 'var(--text-secondary)',
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          marginBottom: 3,
        }}>
          {event.companyName}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, fontSize: 10, flexWrap: 'wrap' }}>
        {priceRange && (
          <span style={{ color: 'var(--text-muted)' }}>
            Range: <span style={{ color: 'var(--text-secondary)' }}>{priceRange}</span>
          </span>
        )}
        {event.sharesOffered != null && (
          <span style={{ color: 'var(--text-muted)' }}>
            Shares: <span style={{ color: 'var(--text-secondary)' }}>{fmtShares(event.sharesOffered)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── DayColumn ────────────────────────────────────────────────────────────────

function DayColumn({ day, isToday }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid var(--border-color)',
        background: isToday ? 'rgba(59,130,246,0.08)' : 'var(--bg-secondary)',
        borderRadius: isToday ? '6px 6px 0 0' : 0,
      }}>
        <div style={{
          fontSize: 12, fontWeight: 700,
          color: isToday ? 'var(--accent-blue)' : 'var(--text-primary)',
        }}>
          {day.label}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
          {day.events.length} {day.events.length === 1 ? 'IPO' : 'IPOs'}
        </div>
      </div>

      {/* Events */}
      <div style={{ padding: '8px', flex: 1, overflowY: 'auto' }}>
        {day.events.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 12 }}>
            —
          </div>
        ) : (
          day.events.map((event, i) => (
            <EventCard key={`${event.symbol || i}-${i}`} event={event} />
          ))
        )}
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function IpoCalendarPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);

  const todayIso = new Date().toISOString().slice(0, 10);

  const fetchCalendar = useCallback(async (offset) => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/ipo/calendar?weekOffset=${offset}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalendar(weekOffset);
  }, [fetchCalendar, weekOffset]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
          IPO Calendar
        </h1>

        {data && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {data.weekStart} – {data.weekEnd}
            {data.totalEvents > 0 && ` · ${data.totalEvents} IPOs`}
          </span>
        )}

        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            style={{
              padding: '4px 10px', borderRadius: 5, fontSize: 13, fontWeight: 700,
              background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            ←
          </button>

          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              style={{
                padding: '4px 10px', borderRadius: 5, fontSize: 11,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              This Week
            </button>
          )}

          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            style={{
              padding: '4px 10px', borderRadius: 5, fontSize: 13, fontWeight: 700,
              background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            →
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '12px 12px 0', display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading…
          </div>
        )}

        {error && (
          <div style={{ padding: 16, color: 'var(--accent-red)', fontSize: 13 }}>
            Error: {error}
          </div>
        )}

        {!loading && !error && data && (
          <div style={{
            display: 'flex', gap: 8, flex: 1, overflow: 'hidden',
            borderRadius: 8, border: '1px solid var(--border-color)',
            overflow: 'hidden',
          }}>
            {data.days.map((day) => (
              <DayColumn
                key={day.date}
                day={day}
                isToday={day.date === todayIso}
              />
            ))}
          </div>
        )}

        {!loading && !error && data && data.totalEvents === 0 && (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            No IPOs scheduled for this week.
          </div>
        )}
      </div>
    </div>
  );
}
