import React, { useCallback, useState } from 'react';

type TradeTicketProps = {
  symbol: string;
};

export default function TradeTicket({ symbol }: TradeTicketProps) {
  const [qty, setQty] = useState<string>('100');
  const [stopPrice, setStopPrice] = useState<string>('');
  const [targetPrice, setTargetPrice] = useState<string>('');

  const onBuy = useCallback(() => {
    console.log('[TradeTicket][BUY]', { symbol, qty, stopPrice, targetPrice });
  }, [symbol, qty, stopPrice, targetPrice]);

  const onSell = useCallback(() => {
    console.log('[TradeTicket][SELL]', { symbol, qty, stopPrice, targetPrice });
  }, [symbol, qty, stopPrice, targetPrice]);

  return (
    <div className="h-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-3 text-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Trade Ticket</div>
      <div className="grid grid-cols-2 gap-2">
        <input value={symbol} readOnly className="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs" />
        <input value={qty} onChange={(event) => setQty(event.target.value)} placeholder="Qty" className="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs" />
        <input value={stopPrice} onChange={(event) => setStopPrice(event.target.value)} placeholder="Stop" className="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs" />
        <input value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} placeholder="Target" className="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-xs" />
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onBuy} className="flex-1 rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">Buy</button>
        <button type="button" onClick={onSell} className="flex-1 rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white">Sell</button>
      </div>
    </div>
  );
}
