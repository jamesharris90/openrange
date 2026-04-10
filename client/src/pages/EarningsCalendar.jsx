/**
 * EarningsCalendar — Yahoo Finance-style week-by-week earnings calendar.
 * Data from /api/earnings/calendar?weekOffset=0
 */
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../utils/api';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtEps(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return `${v >= 0 ? '' : ''}$${Math.abs(v).toFixed(2)}`;
}

function fmtRev(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function fmtMove(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return `±${Number(n).toFixed(1)}%`;
}

function timeLabel(t) {
  if (!t) return null;
  const u = String(t).toUpperCase();
  if (u === 'BMO' || u.includes('BEFORE'))  return { text: 'Pre', color: '#f59e0b' };
  if (u === 'AMC' || u.includes('AFTER'))   return { text: 'Post', color: 'var(--accent-blue)' };
  return null;
}

// ── EarningsEvent card ────────────────────────────────────────────────────────

function EventCard({ event }) {
  const tl = timeLabel(event.reportTime);

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
          {event.symbol}
        </span>
        {tl && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
            background: `${tl.color}22`, color: tl.color, letterSpacing: '0.05em',
          }}>
            {tl.text}
          </span>
        )}
        {event.expectedMovePercent && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {fmtMove(event.expectedMovePercent)}
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

      <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
        <span style={{ color: 'var(--text-muted)' }}>
          EPS: <span style={{ color: 'var(--text-secondary)' }}>{fmtEps(event.epsEstimate)}</span>
          {event.epsActual != null && (
            <span style={{
              marginLeft: 3,
              color: event.epsActual >= event.epsEstimate ? 'var(--accent-green)' : 'var(--accent-red)',
            }}>
              → {fmtEps(event.epsActual)}
            </span>
          )}
        </span>
        {event.revEstimate != null && (
          <span style={{ color: 'var(--text-muted)' }}>
            Rev: <span style={{ color: 'var(--text-secondary)' }}>{fmtRev(event.revEstimate)}</span>
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
          {day.events.length} {day.events.length === 1 ? 'company' : 'companies'}
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
            <EventCard key={`${event.symbol}-${i}`} event={event} />
          ))
        )}
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function EarningsCalendar() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);

  const todayIso = new Date().toISOString().slice(0, 10);

  const fetchCalendar = useCallback(async (offset) => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/earnings/calendar?weekOffset=${offset}`);
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
          Earnings Calendar
        </h1>

        {data && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {data.weekStart} – {data.weekEnd}
            {data.totalEvents > 0 && ` · ${data.totalEvents} events`}
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
            {data.days.map((day, i) => (
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
            No earnings scheduled for this week.
          </div>
        )}
      </div>
    </div>
  );
}
