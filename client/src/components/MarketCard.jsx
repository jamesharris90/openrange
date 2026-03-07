import { useEffect, useState } from 'react';

export default function MarketCard({ symbol }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/market/context')
      .then((r) => r.json())
      .then((d) => setData(d[symbol] || null))
      .catch(() => setData(null));
  }, [symbol]);

  if (!data) return <div className="card">Loading...</div>;

  const price = Number(data.price);
  const changePercent = Number(data.change_percent);
  const hasPrice = Number.isFinite(price);
  const hasChange = Number.isFinite(changePercent);

  return (
    <div className="card">
      <div className="symbol">{symbol}</div>
      <div className="price">{hasPrice ? `$${price.toFixed(2)}` : '--'}</div>
      <div className={hasChange ? (changePercent >= 0 ? 'green' : 'red') : ''}>
        {hasChange ? `${changePercent.toFixed(2)}%` : '--'}
      </div>
    </div>
  );
}
