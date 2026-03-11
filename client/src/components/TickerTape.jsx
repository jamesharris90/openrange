import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';

export default function TickerTape() {
  const [data, setData] = useState({});

  useEffect(() => {
    apiFetch('/api/market/context')
      .then(setData)
      .catch(() => setData({}));
  }, []);

  const symbols = Object.keys(data);

  return (
    <div className="tickerTape">
      {symbols?.map((s) => (
        <span key={s}>
          {s} {Number.isFinite(Number(data[s]?.change_percent)) ? `${Number(data[s].change_percent).toFixed(2)}%` : '--'}
        </span>
      ))}
    </div>
  );
}
