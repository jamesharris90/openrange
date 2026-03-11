import { useEffect, useRef, useState } from 'react';
import { apiJSON } from '@/config/api';

// Badge colours per known symbol/ETF
const BADGE_COLOR = {
  SPY:     '#2563eb', QQQ:  '#7c3aed', VIX:  '#dc2626', DXY:  '#0891b2',
  IWM:     '#0f766e', DIA:  '#1d4ed8', GLD:  '#d97706', TLT:  '#4f46e5',
  // Sectors
  XLC:  '#6366f1', XLF:  '#10b981', XLE:  '#f59e0b', XLV:  '#ec4899',
  XLY:  '#f97316', XLP:  '#84cc16', XLI:  '#06b6d4', XLRE: '#8b5cf6',
  XLU:  '#14b8a6', XLB:  '#a78bfa', XLK:  '#3b82f6', BITO: '#f97316',
};

// Map raw ticker to display badge text
const BADGE_LABEL = {
  '^VIX':     'VIX',
  'DX-Y.NYB': 'DXY',
};

// Display name overrides
const DISPLAY_NAME = {
  '^VIX':     'VIX',
  'DX-Y.NYB': 'DXY',
  SPY: 'S&P 500',
  QQQ: 'NASDAQ 100',
};

// Hover tooltip descriptions
const DESCRIPTION = {
  SPY:        'SPDR S&P 500 ETF — tracks the S&P 500 index (500 largest US companies)',
  QQQ:        'Invesco QQQ ETF — tracks the NASDAQ-100 (top 100 non-financial NASDAQ stocks)',
  '^VIX':     'CBOE Volatility Index — measures expected 30-day S&P 500 volatility',
  'DX-Y.NYB': 'US Dollar Index — measures USD against a basket of 6 major currencies',
  IWM:        'iShares Russell 2000 ETF — tracks 2,000 small-cap US stocks',
  DIA:        'SPDR Dow Jones ETF — tracks the Dow Jones Industrial Average (30 blue chips)',
  GLD:        'SPDR Gold Shares ETF — tracks physical gold price',
  TLT:        'iShares 20+ Year Treasury Bond ETF — tracks long-duration US government bonds',
  // Sectors
  XLC:        'Communication Services Select Sector SPDR — Meta, Alphabet, Netflix, Disney',
  XLF:        'Financial Select Sector SPDR — JPMorgan, Berkshire, Visa, Mastercard',
  XLE:        'Energy Select Sector SPDR — ExxonMobil, Chevron, ConocoPhillips',
  XLV:        'Health Care Select Sector SPDR — UnitedHealth, Johnson & Johnson, Pfizer',
  XLY:        'Consumer Discretionary Select Sector SPDR — Amazon, Tesla, Home Depot',
  XLP:        'Consumer Staples Select Sector SPDR — Procter & Gamble, Coca-Cola, Walmart',
  XLI:        'Industrials Select Sector SPDR — GE Aerospace, Caterpillar, Deere',
  XLRE:       'Real Estate Select Sector SPDR — American Tower, Prologis, Crown Castle',
  XLU:        'Utilities Select Sector SPDR — NextEra, Southern Company, Duke Energy',
  XLB:        'Materials Select Sector SPDR — Linde, Air Products, Freeport-McMoRan',
  XLK:        'Technology Select Sector SPDR — Apple, Microsoft, Nvidia, Broadcom',
  BITO:       'ProShares Bitcoin ETF — tracks Bitcoin futures contracts',
};

function badge(ticker) {
  return BADGE_LABEL[ticker] || ticker.replace('^', '').slice(0, 4);
}

function badgeColor(ticker) {
  const b = badge(ticker);
  return BADGE_COLOR[b] || BADGE_COLOR[ticker] || '#4a9eff';
}

function fmtPrice(price) {
  if (price == null) return '—';
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 10)   return price.toFixed(2);
  if (price >= 1)    return price.toFixed(3);
  return price.toFixed(4);
}

function TickerItem({ item }) {
  const isUp = (item.changePercent ?? 0) >= 0;
  const color = isUp ? 'var(--accent-green)' : 'var(--accent-red)';
  const bg = badgeColor(item.ticker);
  const label = DISPLAY_NAME[item.ticker] || item.ticker.replace('^', '');
  const badgeTxt = badge(item.ticker);
  const desc = DESCRIPTION[item.ticker] || null;

  return (
    <div
      className="flex items-center gap-3 px-5 border-r border-[var(--border-color)] shrink-0 h-full cursor-default"
      title={desc || label}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[8px] font-black text-white tracking-wide"
        style={{ backgroundColor: bg }}
      >
        {badgeTxt}
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-[11px] text-[var(--text-muted)] font-medium whitespace-nowrap">{label}</span>
        <span className="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">
          {fmtPrice(item.price)}
        </span>
      </div>
      <div className="flex flex-col items-end leading-tight" style={{ color }}>
        <span className="text-[12px] font-semibold tabular-nums whitespace-nowrap">
          {isUp ? '▲' : '▼'} {item.changePercent != null ? `${Math.abs(item.changePercent).toFixed(2)}%` : '—'}
        </span>
        <span className="text-[10px] tabular-nums opacity-80">
          {item.change != null ? (item.change >= 0 ? '+' : '') + item.change.toFixed(2) : '—'}
        </span>
      </div>
    </div>
  );
}

export default function TickerTape() {
  const [items, setItems] = useState([]);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef(null);

  async function loadData() {
    try {
      const [ctx, sec] = await Promise.all([
        apiJSON('/api/ai-quant/market-context'),
        apiJSON('/api/ai-quant/sector-performance'),
      ]);

      const combined = [];

      for (const idx of ctx.indices || []) {
        if (idx.price) combined.push({ ticker: idx.ticker, price: idx.price, change: idx.change, changePercent: idx.changePercent });
      }

      for (const s of sec.sectors || []) {
        combined.push({ ticker: s.etf, price: s.price, change: s.change, changePercent: s.changePercent });
      }

      if (combined.length) setItems(combined);
    } catch {
      // silently fail — strip just won't show
    }
  }

  useEffect(() => {
    loadData();
    timerRef.current = setInterval(loadData, 60_000);
    return () => clearInterval(timerRef.current);
  }, []);

  if (!items.length) return null;

  const doubled = [...items, ...items];

  return (
    <div
      className="relative flex h-14 w-full overflow-hidden border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] select-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      title="Hover to pause"
    >
      {/* Edge fades */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-12 bg-gradient-to-r from-[var(--bg-sidebar)] to-transparent" />
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-12 bg-gradient-to-l from-[var(--bg-sidebar)] to-transparent" />

      <div
        className="flex items-center h-full"
        style={{
          animation: `ticker-scroll ${items.length * 3.5}s linear infinite`,
          animationPlayState: paused ? 'paused' : 'running',
          width: 'max-content',
        }}
      >
        {doubled?.map((item, i) => (
          <TickerItem key={`${item.ticker}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}
