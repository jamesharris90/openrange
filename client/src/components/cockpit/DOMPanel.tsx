import React, { useMemo } from 'react';
import { useBroker } from '../../context/BrokerContext';

type DomRow = {
  bidSize: number;
  bidPrice: number;
  askPrice: number;
  askSize: number;
};

type DOMPanelProps = {
  midPrice: number | null;
  symbol?: string;
};

export default function DOMPanel({ midPrice, symbol }: DOMPanelProps) {
  const broker = useBroker();
  const rows = useMemo<DomRow[]>(() => {
    const base = Number.isFinite(midPrice) ? Number(midPrice) : 100;
    return Array.from({ length: 8 }, (_, idx) => {
      const step = (idx + 1) * 0.01;
      return {
        bidSize: 1200 - idx * 80,
        bidPrice: Number((base - step).toFixed(2)),
        askPrice: Number((base + step).toFixed(2)),
        askSize: 1100 - idx * 70,
      };
    });
  }, [midPrice]);

  return (
    <div className="h-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {symbol ? `${symbol} DOM (Mock)` : 'DOM (Mock)'}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
            <span className={`inline-block h-2 w-2 rounded-full ${broker.connected ? 'bg-emerald-500' : 'bg-gray-500'}`} />
            {broker.connected ? `${broker.broker} connected` : 'disconnected'}
          </span>
          <button
            type="button"
            onClick={broker.connectIbkr}
            disabled={broker.connected}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Connect IBKR
          </button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1 text-xs font-semibold text-[var(--text-secondary)]">
        <div>Bid Size</div>
        <div>Bid</div>
        <div>Ask</div>
        <div>Ask Size</div>
      </div>
      <div className="mt-2 space-y-1">
        {rows?.map((row, idx) => (
          <div key={`dom-${idx}`} className="grid grid-cols-4 gap-1 rounded bg-[var(--bg-input)] px-1 py-1 text-xs">
            <div>{row.bidSize}</div>
            <div className="text-emerald-500">{row.bidPrice.toFixed(2)}</div>
            <div className="text-red-500">{row.askPrice.toFixed(2)}</div>
            <div>{row.askSize}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
