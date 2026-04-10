import React from 'react';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pickArray(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function asPrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '--';
  return parsed >= 100 ? parsed.toFixed(2) : parsed.toFixed(3);
}

function resolveIndices(marketContext) {
  const fromObject = [
    marketContext?.indices,
    marketContext?.market_indices,
    marketContext?.snapshot?.indices,
    marketContext?.data?.indices,
  ];

  for (const group of fromObject) {
    if (group && typeof group === 'object' && !Array.isArray(group)) {
      const records = [
        { symbol: 'SPY', ...group.SPY },
        { symbol: 'QQQ', ...group.QQQ },
        { symbol: 'VIX', ...group.VIX },
      ];
      if (records.some((item) => item.price != null || item.change_percent != null || item.changePercent != null)) {
        return records;
      }
    }
  }

  const asArray = pickArray(marketContext?.indices, marketContext?.data, marketContext?.rows, marketContext?.items);
  const bySymbol = new Map(
    asArray
      .map((row) => ({ ...row, symbol: String(row?.symbol || row?.ticker || '').toUpperCase() }))
      .filter((row) => row.symbol)
      .map((row) => [row.symbol, row])
  );

  return ['SPY', 'QQQ', 'VIX'].map((symbol) => ({ symbol, ...(bySymbol.get(symbol) || {}) }));
}

function TrendArrow({ value }) {
  if (value > 0) return <span className="text-emerald-300">▲</span>;
  if (value < 0) return <span className="text-rose-300">▼</span>;
  return <span className="text-slate-400">•</span>;
}

function IndexTile({ item }) {
  const symbol = String(item?.symbol || '--').toUpperCase();
  const change = toNumber(item?.change_percent ?? item?.changePercent ?? item?.percent_change, 0);
  const price = asPrice(item?.price ?? item?.last ?? item?.close);

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 py-2 shadow-[0_6px_16px_rgba(2,6,23,0.25)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-[0.12em] text-slate-300">{symbol}</span>
        <TrendArrow value={change} />
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{price}</div>
      <div className={`text-xs ${change >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
        {change >= 0 ? '+' : ''}{change.toFixed(2)}%
      </div>
    </div>
  );
}

export default function MarketContextBar({ marketContext }) {
  const indices = resolveIndices(marketContext);

  return (
    <section className="col-span-12 rounded-2xl border border-slate-700/80 bg-slate-950/85 p-4 shadow-[0_10px_28px_rgba(2,6,23,0.28)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-200">Market Context</h2>
          <p className="mt-1 text-sm text-slate-300">Futures flat, volatility elevated, semiconductors leading</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {indices.map((item) => (
            <IndexTile key={item.symbol || Math.random()} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
