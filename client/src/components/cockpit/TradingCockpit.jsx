import { useMemo, useState } from 'react';
import Card from '../shared/Card';
import TradingViewChart from '../shared/TradingViewChart';
import { useSymbol } from '../../context/SymbolContext';
import ScannerPanel from './ScannerPanel';
import NewsPanel from './NewsPanel';
import SignalsPanel from './SignalsPanel';
import OrderPanel from './OrderPanel';

const WATCHLIST = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL'];

export default function TradingCockpit() {
  const { selectedSymbol, setSelectedSymbol } = useSymbol();
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

  const watchlistRows = useMemo(() => WATCHLIST, []);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <ScannerPanel />

      <Card className="h-full p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold">Chart</h3>
          <span className="text-xs text-[var(--text-muted)]">{selectedSymbol}</span>
        </div>
        <TradingViewChart
          symbol={selectedSymbol}
          height={330}
          interval="15"
          hideSideToolbar={false}
          studies={['VWAP@tv-basicstudies', 'MASimple@tv-basicstudies', 'Volume@tv-basicstudies']}
        />
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
          {watchlistRows.map((symbol) => (
            <button
              key={symbol}
              type="button"
              onClick={() => setSelectedSymbol(symbol)}
              className={`rounded-md border px-2 py-2 text-xs ${selectedSymbol === symbol ? 'border-blue-500 bg-blue-500/15 text-blue-100' : 'border-[var(--border-color)] text-[var(--text-secondary)]'}`}
            >
              {symbol}
            </button>
          ))}
        </div>

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
