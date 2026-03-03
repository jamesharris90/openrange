import React, { useMemo } from 'react';
import useApi from '../hooks/useApi';
import { formatNumber } from '../utils/formatters';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';

export default function MarketHoursPage() {
  const { data: snapshot, loading } = useApi('/api/v5/chart?symbol=SPY&timeframe=1D&interval=1min', []);

  const sessionState = useMemo(() => {
    const minute = Number(snapshot?.sessionMinute);
    const isOpen = Number.isFinite(minute) && minute >= 0;

    const candles = Array.isArray(snapshot?.candles) ? snapshot.candles : [];
    const latest = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    const latestClose = Number(latest?.close);
    const prevClose = Number(previous?.close);
    const latestVolume = Number(latest?.volume);
    const change = Number.isFinite(latestClose) && Number.isFinite(prevClose)
      ? latestClose - prevClose
      : null;

    return {
      isOpen,
      session: isOpen ? 'Regular' : 'Closed',
      nextSession: '--',
      price: Number.isFinite(latestClose) ? latestClose : null,
      change,
      volume: Number.isFinite(latestVolume) ? latestVolume : null,
    };
  }, [snapshot]);

  return (
    <PageContainer className="space-y-3">
      <PageHeader
        title="Market Hours"
        subtitle="Session clock and quick pulse of market breadth."
      />

      <div className="panel grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        <StatCard label="Status" value={sessionState.isOpen ? 'Open' : 'Closed'} highlight={sessionState.isOpen} loading={loading} />
        <StatCard label="Next Session" value={sessionState.nextSession} loading={loading} />
        <StatCard label="Current Session" value={sessionState.session} loading={loading} />
      </div>

      <div className="panel">
        <h3 className="mt-0">SPY Snapshot</h3>
        {snapshot && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="stat-card">
              <div className="stat-label">Price</div>
              <div className="stat-value">${formatNumber(sessionState.price)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Change</div>
              <div className={(sessionState.change ?? 0) < 0 ? 'text-negative' : 'text-positive'}>
                {sessionState.change == null ? '--' : formatNumber(sessionState.change)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Volume</div>
              <div className="stat-value">{formatNumber(sessionState.volume)}</div>
            </div>
          </div>
        )}
        {!snapshot && <div className="muted">Pulling latest quotes…</div>}
      </div>
    </PageContainer>
  );
}

function StatCard({ label, value, highlight, loading }) {
  return (
    <div className="stat-card" style={{ padding: 14, border: highlight ? '1px solid var(--accent-green)' : '1px solid var(--border-color)' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: highlight ? 'var(--accent-green)' : undefined }}>
        {loading ? 'Loading…' : value}
      </div>
    </div>
  );
}
