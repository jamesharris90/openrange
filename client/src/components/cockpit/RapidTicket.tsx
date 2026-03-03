import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '../../utils/api';
import { useBroker } from '../../context/BrokerContext';

type RapidTicketProps = {
  symbol: string;
  referencePrice?: number | null;
};

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function RapidTicket({ symbol, referencePrice = null }: RapidTicketProps) {
  const broker = useBroker();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('LIMIT');
  const [quantity, setQuantity] = useState('100');
  const [entry, setEntry] = useState(referencePrice ? String(referencePrice.toFixed(2)) : '');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [riskBudget, setRiskBudget] = useState('250');
  const [rrMultiple, setRrMultiple] = useState('2');
  const [quote, setQuote] = useState<{ ask: number | null; bid: number | null; price: number | null }>({ ask: null, bid: null, price: null });

  useEffect(() => {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (!normalized) return;

    let active = true;
    const controller = new AbortController();

    const run = async () => {
      try {
        const response = await authFetch(`/api/quote?symbol=${encodeURIComponent(normalized)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json();
        const ask = Number(payload?.ask);
        const bid = Number(payload?.bid);
        const price = Number(payload?.price);
        if (!active) return;
        setQuote({
          ask: Number.isFinite(ask) ? ask : null,
          bid: Number.isFinite(bid) ? bid : null,
          price: Number.isFinite(price) ? price : null,
        });
      } catch (_error) {
      }
    };

    run();
    const id = window.setInterval(run, 3000);

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(id);
    };
  }, [symbol]);

  useEffect(() => {
    if (orderType !== 'MARKET') return;
    if (!Number.isFinite(quote.ask)) return;
    setEntry(Number(quote.ask).toFixed(2));
  }, [orderType, quote.ask]);

  useEffect(() => {
    if (orderType === 'MARKET') return;
    if (!entry && Number.isFinite(referencePrice)) {
      setEntry(Number(referencePrice).toFixed(2));
    }
  }, [orderType, referencePrice, entry]);

  const parsedEntry = toNumber(entry);
  const parsedStop = toNumber(stop);
  const parsedRisk = toNumber(riskBudget);
  const parsedQty = toNumber(quantity);
  const parsedRr = toNumber(rrMultiple);

  const riskPerShare = (parsedEntry != null && parsedStop != null)
    ? Math.abs(parsedEntry - parsedStop)
    : null;

  useEffect(() => {
    if (!(riskPerShare != null && riskPerShare > 0 && parsedRisk != null && parsedRisk > 0)) return;
    const nextQty = Math.floor(parsedRisk / riskPerShare);
    if (!Number.isFinite(nextQty) || nextQty < 1) return;
    if (String(nextQty) !== quantity) {
      setQuantity(String(nextQty));
    }
  }, [riskPerShare, parsedRisk, quantity]);

  useEffect(() => {
    if (!(parsedEntry != null && riskPerShare != null && riskPerShare > 0 && parsedRr != null && parsedRr > 0)) return;
    const nextTarget = side === 'BUY'
      ? parsedEntry + (riskPerShare * parsedRr)
      : parsedEntry - (riskPerShare * parsedRr);
    const rounded = nextTarget.toFixed(2);
    if (rounded !== target) {
      setTarget(rounded);
    }
  }, [side, parsedEntry, riskPerShare, parsedRr, target]);

  const metrics = useMemo(() => {
    const qty = parsedQty;
    const entryNum = parsedEntry;
    const stopNum = parsedStop;
    const targetNum = toNumber(target);
    const riskBudgetNum = parsedRisk;

    const riskPerShare = (entryNum != null && stopNum != null) ? Math.abs(entryNum - stopNum) : null;
    const rewardPerShare = (entryNum != null && targetNum != null)
      ? Math.abs(targetNum - entryNum)
      : null;
    const totalRisk = (riskPerShare != null && qty != null) ? riskPerShare * qty : null;
    const rr = (riskPerShare != null && rewardPerShare != null && riskPerShare > 0)
      ? rewardPerShare / riskPerShare
      : null;
    const suggestedQty = (riskPerShare != null && riskBudgetNum != null && riskPerShare > 0)
      ? Math.floor(riskBudgetNum / riskPerShare)
      : null;

    return {
      riskPerShare,
      rewardPerShare,
      totalRisk,
      rr,
      suggestedQty,
    };
  }, [parsedQty, parsedEntry, parsedStop, target, parsedRisk]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSide('BUY')}
          className={`rounded border px-2 py-1 text-xs font-semibold ${side === 'BUY' ? 'border-emerald-600 bg-emerald-600/20 text-emerald-200' : 'border-gray-700 text-gray-300'}`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => setSide('SELL')}
          className={`rounded border px-2 py-1 text-xs font-semibold ${side === 'SELL' ? 'border-red-600 bg-red-600/20 text-red-200' : 'border-gray-700 text-gray-300'}`}
        >
          Sell
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="space-y-1">
          <span className="text-gray-400">Order</span>
          <select
            value={orderType}
            onChange={(event) => setOrderType(event.currentTarget.value as 'MARKET' | 'LIMIT')}
            className="h-8 w-full rounded border border-gray-700 bg-gray-950 px-2 text-gray-200"
          >
            <option value="MARKET">Market</option>
            <option value="LIMIT">Limit</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">Qty</span>
          <input value={quantity} onChange={(event) => setQuantity(event.currentTarget.value)} className="h-8 w-full rounded border border-gray-700 bg-gray-950 px-2 text-gray-200" />
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">RR</span>
          <input value={rrMultiple} onChange={(event) => setRrMultiple(event.currentTarget.value)} className="h-8 w-full rounded border border-gray-700 bg-gray-950 px-2 text-gray-200" />
        </label>

        <label className="space-y-1">
          <span className="text-gray-400">Entry</span>
          <input value={entry} onChange={(event) => setEntry(event.currentTarget.value)} className="h-8 w-full rounded border border-gray-700 bg-gray-950 px-2 text-gray-200" disabled={orderType === 'MARKET'} />
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">Stop</span>
          <input value={stop} onChange={(event) => setStop(event.currentTarget.value)} className="h-8 w-full rounded border border-gray-700 bg-gray-950 px-2 text-gray-200" />
        </label>

        <label className="space-y-1">
          <span className="text-gray-400">Target</span>
          <input value={target} onChange={(event) => setTarget(event.currentTarget.value)} className="h-8 w-full rounded border border-gray-700 bg-gray-950 px-2 text-gray-200" disabled />
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">Risk $</span>
          <input value={riskBudget} onChange={(event) => setRiskBudget(event.currentTarget.value)} className="h-8 w-full rounded border border-gray-700 bg-gray-950 px-2 text-gray-200" />
        </label>
      </div>

      <div className="rounded border border-gray-800 bg-gray-950 p-2 text-xs text-gray-300">
        <div>{symbol} • {side} • {orderType}</div>
        <div className="mt-1">ASK: {quote.ask != null ? `$${quote.ask.toFixed(2)}` : '—'} • BID: {quote.bid != null ? `$${quote.bid.toFixed(2)}` : '—'}</div>
        <div className="mt-1">Risk/share: {metrics.riskPerShare != null ? `$${metrics.riskPerShare.toFixed(2)}` : '—'}</div>
        <div>R:R: {metrics.rr != null ? `${metrics.rr.toFixed(2)}R` : '—'}</div>
        <div>Total risk: {metrics.totalRisk != null ? `$${metrics.totalRisk.toFixed(2)}` : '—'}</div>
        <div>Suggested qty: {metrics.suggestedQty != null ? metrics.suggestedQty : '—'}</div>
      </div>

      {broker.connected ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="rounded border border-emerald-600 bg-emerald-600/20 px-2 py-1 text-xs font-semibold text-emerald-200">BUY</button>
          <button type="button" className="rounded border border-red-600 bg-red-600/20 px-2 py-1 text-xs font-semibold text-red-200">SELL</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={broker.connectIbkr}
          className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-gray-200"
        >
          Connect Broker
        </button>
      )}
    </div>
  );
}