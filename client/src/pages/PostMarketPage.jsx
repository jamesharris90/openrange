import React from 'react';
import GappersPage from '../components/gappers/GappersPage';

export default function PostMarketPage() {
  return (
    <div className="page-container">
      <div className="panel" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Post-Market</h2>
        <p className="muted" style={{ marginTop: 4 }}>After-hours movers with quick research and watchlist sync.</p>
      </div>
      <GappersPage title="After-Hours Movers" endpoint="/api/gappers?limit=80&news=1" />
    </div>
  );
}
