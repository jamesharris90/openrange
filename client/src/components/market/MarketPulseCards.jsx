import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';
import MarketIndexCard from './MarketIndexCard';

const TARGETS = ['SPY', 'QQQ', 'IWM', 'VIX', 'DXY', '10Y'];

function normalizeIndices(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.indices) ? payload.indices : []);
  const map = new Map(rows.map((row) => [String(row?.symbol || '').toUpperCase(), row]));

  return TARGETS.map((symbol) => {
    if (symbol === '10Y') {
      return map.get('10Y') || map.get('TNX') || map.get('^TNX') || { symbol: '10Y', price: null, change_percent: null };
    }
    return map.get(symbol) || { symbol, price: null, change_percent: null };
  });
}

export default function MarketPulseCards() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/market/indices');
        if (!cancelled) setRows(normalizeIndices(payload));
      } catch {
        if (!cancelled) setRows([]);
      }
    }

    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const cards = useMemo(() => (rows.length ? rows : TARGETS.map((symbol) => ({ symbol }))), [rows]);

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((row) => <MarketIndexCard key={row.symbol} row={row} />)}
    </div>
  );
}
