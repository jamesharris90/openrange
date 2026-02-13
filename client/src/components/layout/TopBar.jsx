import { useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';

const PAGE_TITLES = {
  '/watchlist': 'Watchlist',
  '/earnings': 'Earnings Calendar',
  '/ai-quant': 'Intelligence Engine',
};

export default function TopBar() {
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'OpenRange Trader';
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetch('/api/market-status')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setStatus(d))
      .catch(() => {});
  }, []);

  return (
    <div className="top-bar">
      <h1 className="page-title">{title}</h1>
      <div className="top-bar-actions">
        {status && (
          <div className="market-status">
            <span className={`status-dot ${status.isOpen ? 'status-dot--open' : 'status-dot--closed'}`} />
            <span>{status.isOpen ? 'Market Open' : 'Market Closed'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
