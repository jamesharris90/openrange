import { useEffect, useState } from 'react';

export default function TickerTape() {
  const [data, setData] = useState({});

  useEffect(() => {
    fetch('/api/market/context')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({}));
  }, []);

  const symbols = Object.keys(data);

  return (
    <div className="tickerTape">
      {symbols.map((s) => (
        <span key={s}>
          {s} {Number.isFinite(Number(data[s]?.change_percent)) ? `${Number(data[s].change_percent).toFixed(2)}%` : '--'}
        </span>
      ))}
    </div>
  );
}
