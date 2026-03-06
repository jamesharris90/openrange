import { useEffect, useMemo, useState } from 'react';
import Card from '../ui/Card';
import ButtonPrimary from '../ui/ButtonPrimary';
import ButtonSecondary from '../ui/ButtonSecondary';
import BrokerConnectPanel from './BrokerConnectPanel';
import { apiJSON } from '../../config/api';
import { useSymbol } from '../../context/SymbolContext';

const STORAGE_KEY = 'openrange:broker-token';

function fmt(value, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '--';
  return parsed.toFixed(digits);
}

function getBrokerToken() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export default function OrderPanel({ brokerFeed, onSubmitOrder }) {
  const { selectedSymbol } = useSymbol();
  const [token, setToken] = useState(getBrokerToken());
  const [side, setSide] = useState('BUY');
  const [size, setSize] = useState('100');
  const [quote, setQuote] = useState({ bid: null, ask: null, last: null });

  useEffect(() => {
    const sync = () => setToken(getBrokerToken());
    sync();
    const timer = setInterval(sync, 2500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadQuote() {
      try {
        const payload = await apiJSON(`/api/quote?symbol=${encodeURIComponent(selectedSymbol)}`);
        if (!cancelled) {
          setQuote({
            bid: payload?.bid ?? payload?.best_bid ?? null,
            ask: payload?.ask ?? payload?.best_ask ?? null,
            last: payload?.price ?? payload?.last ?? null,
          });
        }
      } catch {
        if (!cancelled) setQuote({ bid: null, ask: null, last: null });
      }
    }

    loadQuote();
    const timer = setInterval(loadQuote, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedSymbol]);

  const effectiveFeed = useMemo(() => ({
    bid: quote.bid ?? brokerFeed?.bid,
    ask: quote.ask ?? brokerFeed?.ask,
    price: quote.last ?? brokerFeed?.price,
  }), [quote, brokerFeed]);

  if (!token) {
    return (
      <Card className="h-full p-4">
        <h3 className="m-0 mb-2 text-sm font-semibold">Order Entry</h3>
        <BrokerConnectPanel />
      </Card>
    );
  }

  return (
    <Card className="h-full p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">Order Entry</h3>
        <span className="text-xs text-[var(--text-muted)]">{selectedSymbol}</span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3 text-xs">
        <div>
          <div className="text-[var(--text-muted)]">Bid</div>
          <div className="font-semibold">{fmt(effectiveFeed.bid, 2)}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)]">Ask</div>
          <div className="font-semibold">{fmt(effectiveFeed.ask, 2)}</div>
        </div>
        <div>
          <div className="text-[var(--text-muted)]">Last</div>
          <div className="font-semibold">{fmt(effectiveFeed.price, 2)}</div>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs">
          Position Size
          <input
            value={size}
            onChange={(event) => setSize(event.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <ButtonSecondary onClick={() => setSide('BUY')} className={side === 'BUY' ? '!border-emerald-500 !bg-emerald-600/20 !text-emerald-100' : ''}>Buy</ButtonSecondary>
          <ButtonSecondary onClick={() => setSide('SELL')} className={side === 'SELL' ? '!border-rose-500 !bg-rose-600/20 !text-rose-100' : ''}>Sell</ButtonSecondary>
        </div>

        <ButtonPrimary
          className="w-full"
          onClick={() => onSubmitOrder?.({ symbol: selectedSymbol, side, size: Number(size || 0) })}
        >
          Send {side} Order
        </ButtonPrimary>
      </div>
    </Card>
  );
}
