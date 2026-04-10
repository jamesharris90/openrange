import { useEffect, useMemo, useState } from 'react';
import Card from '../shared/Card';
import TradingViewChart from '../shared/TradingViewChart';
import { useSymbol } from '../../context/SymbolContext';
import ScannerPanel from './ScannerPanel';
import NewsPanel from './NewsPanel';
import SignalsPanel from './SignalsPanel';
import OrderPanel from './OrderPanel';

export default function TradingCockpit() {
  const { selectedSymbol, setSelectedSymbol } = useSymbol();
  const [watchlistRows, setWatchlistRows] = useState([]);
  const [brokerFeed] = useState({
    price: null,
    bid: null,
    ask: null,
    size: null,
    positions: [],
    orders: [],
    fills: [],
  });
  const [orderStatus, setOrderStatus] = useState('No order submitted.');

  useEffect(() => {
    let active = true;

    async function loadWatchlist() {
      try {
        const response = await fetch('/api/intelligence/top-opportunities?limit=12', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('watchlist_fetch_failed');
        }
        const payload = await response.json();
        const symbols = Array.isArray(payload?.data)
          ? payload.data
              .map((row) => String(row.symbol || '').toUpperCase())
              .filter(Boolean)
              .slice(0, 8)
          : [];

        if (!active) return;
        setWatchlistRows(Array.from(new Set(symbols)));
      } catch (_error) {
        if (!active) return;
        setWatchlistRows([]);
      }
    }

    void loadWatchlist();
    const timer = window.setInterval(loadWatchlist, 30000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedSymbol && watchlistRows.length > 0) {
      setSelectedSymbol(watchlistRows[0]);
    }
  }, [selectedSymbol, setSelectedSymbol, watchlistRows]);

  const activeSymbol = useMemo(() => selectedSymbol || watchlistRows[0] || '', [selectedSymbol, watchlistRows]);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <ScannerPanel />

      <Card className="h-full p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold">Multi-Timeframe Charts</h3>
          <span className="text-xs text-[var(--text-muted)]">{activeSymbol || 'Waiting for live symbols'}</span>
        </div>
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {!activeSymbol ? (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300 lg:col-span-2">
              Chart panel blocked: no live symbol available.
            </div>
          ) : (
            <>
              <div className="rounded border border-[var(--border-color)] p-2">
                <div className="mb-1 text-xs text-[var(--text-muted)]">1m execution</div>
                <TradingViewChart
                  symbol={activeSymbol}
                  height={320}
                  interval="1"
                  hideSideToolbar={false}
                  studies={['VWAP@tv-basicstudies', 'MASimple@tv-basicstudies', 'Volume@tv-basicstudies']}
                />
              </div>
              <div className="grid gap-2">
                <div className="rounded border border-[var(--border-color)] p-2">
                  <div className="mb-1 text-xs text-[var(--text-muted)]">5m structure</div>
                  <TradingViewChart symbol={activeSymbol} height={152} interval="5" hideSideToolbar studies={['VWAP@tv-basicstudies', 'Volume@tv-basicstudies']} />
                </div>
                <div className="rounded border border-[var(--border-color)] p-2">
                  <div className="mb-1 text-xs text-[var(--text-muted)]">1D context</div>
                  <TradingViewChart symbol={activeSymbol} height={152} interval="1D" hideSideToolbar studies={['MASimple@tv-basicstudies', 'Volume@tv-basicstudies']} />
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      <NewsPanel />

      <OrderPanel
        brokerFeed={brokerFeed}
        onSubmitOrder={(order) => {
          const side = String(order?.side || 'BUY');
          const size = Number(order?.size || 0);
          setOrderStatus(`${side} ${Math.max(0, size)} ${selectedSymbol} queued (simulated).`);
        }}
      />

      <SignalsPanel />

      <Card className="h-full p-4">
        <h3 className="m-0 mb-3 text-sm font-semibold">Watchlist</h3>
        <div className="mb-3 grid grid-cols-3 gap-2">
          {watchlistRows?.map((symbol) => (
            <button
              key={symbol}
              type="button"
              onClick={() => setSelectedSymbol(symbol)}
              className={`rounded-md border px-2 py-2 text-xs ${activeSymbol === symbol ? 'border-blue-500 bg-blue-500/15 text-blue-100' : 'border-[var(--border-color)] text-[var(--text-secondary)]'}`}
            >
              {symbol}
            </button>
          ))}
        </div>
        {watchlistRows.length === 0 ? <div className="mb-3 text-xs text-red-400">Watchlist unavailable: no live symbols returned</div> : null}

        <div className="mb-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-muted)]">
          {orderStatus}
        </div>

        <div>
          <h4 className="m-0 mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Broker Feed Placeholder</h4>
          <pre className="max-h-36 overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-[10px] text-[var(--text-muted)]">{JSON.stringify(brokerFeed, null, 2)}</pre>
        </div>
      </Card>
    </div>
  );
}
