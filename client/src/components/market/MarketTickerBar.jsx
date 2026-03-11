import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';
import TickerLink from '../shared/TickerLink';
import Sparkline from '../charts/Sparkline';

const TARGETS = ['SPY', 'QQQ', 'VIX', 'SMH', 'XLF', 'EURUSD', 'BTC'];
const SECTOR_DESC = {
  SPY: 'S&P 500 broad market ETF',
  QQQ: 'Nasdaq-100 growth ETF',
  VIX: 'Volatility index',
  SMH: 'Semiconductor ETF',
  XLF: 'Financial sector ETF',
  EURUSD: 'Euro / US Dollar FX pair',
  BTC: 'Bitcoin spot proxy',
};

function findRow(rows, symbol) {
  if (symbol === '10Y') return rows.find((row) => ['10Y', 'TNX', '^TNX'].includes(String(row?.symbol || '').toUpperCase()));
  if (symbol === 'VIX') return rows.find((row) => ['VIX', '^VIX'].includes(String(row?.symbol || '').toUpperCase()));
  return rows.find((row) => String(row?.symbol || '').toUpperCase() === symbol);
}

function fmt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

export default function MarketTickerBar() {
  const [rows, setRows] = useState([]);
  const [sectorStrength, setSectorStrength] = useState({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [marketContext, premarketSummary] = await Promise.all([
          apiJSON('/api/market/context').catch(() => ({})),
          apiJSON('/api/premarket/summary').catch(() => ({})),
        ]);

        const summaryRows = Array.isArray(premarketSummary?.index_cards) ? premarketSummary.index_cards : [];
        const contextMap = marketContext && typeof marketContext === 'object' ? marketContext : {};

        const payloads = TARGETS?.map((symbol) => {
          const ctx = contextMap[symbol] || {};
          const summary = summaryRows.find((row) => String(row?.symbol || '').toUpperCase() === symbol) || {};
          return {
            symbol,
            price: ctx?.current_price ?? ctx?.price ?? summary?.price ?? null,
            change_percent: ctx?.pct_change ?? ctx?.change_percent ?? summary?.change_percent ?? null,
            sector: ctx?.sector || null,
            sparkline: Array.isArray(summary?.sparkline) ? summary.sparkline : null,
          };
        });

        const strengths = {};
        summaryRows.forEach((row) => {
          const symbol = String(row?.symbol || '').toUpperCase();
          strengths[symbol] = Number(row?.change_percent || row?.gap_percent || 0);
        });

        if (!cancelled) {
          setRows(payloads);
          setSectorStrength(strengths);
        }
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

  const stream = useMemo(() => {
    const normalized = TARGETS?.map((symbol) => ({
      symbol,
      row: findRow(rows, symbol) || { symbol, price: null, change_percent: null, sparkline: null },
    }));
    return [...normalized, ...normalized];
  }, [rows]);

  return (
    <div className="border-b border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <div className="group overflow-hidden px-3">
        <div className="flex min-w-max items-center gap-6 py-2 text-xs group-hover:[animation-play-state:paused]" style={{ animation: 'ticker-scroll 38s linear infinite' }}>
          {stream?.map((item, idx) => {
            const cp = Number(item.row?.change_percent);
            const color = !Number.isFinite(cp) ? 'text-amber-300' : cp > 0 ? 'text-emerald-400' : cp < 0 ? 'text-rose-400' : 'text-amber-300';
            return (
              <div
                key={`${item.symbol}-${idx}`}
                className="flex items-center gap-2 whitespace-nowrap"
                title={`${item.symbol}\n${SECTOR_DESC[item.symbol] || 'Market instrument'}\nSector Strength: ${(Number(sectorStrength[item.symbol] || 0)).toFixed(2)}%`}
              >
                <TickerLink symbol={item.symbol} className="text-xs" />
                <span className="text-[var(--text-secondary)]">{Number.isFinite(Number(item.row?.price)) ? Number(item.row?.price).toFixed(2) : '--'}</span>
                <span className={color}>{fmt(item.row?.change_percent)} {cp >= 0 ? '▲' : '▼'}</span>
                <Sparkline
                  points={item.row?.sparkline}
                  symbol={item.symbol}
                  positive={cp >= 0}
                  width={64}
                  height={18}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
