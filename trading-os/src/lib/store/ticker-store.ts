import { create } from "zustand";

import type { AlertRow, HeatmapRow, MarketQuote, Opportunity, Timeframe } from "@/lib/types";

type TickerStore = {
  activeTicker: string;
  watchlist: string[];
  quotes: Record<string, MarketQuote>;
  signals: Opportunity[];
  alerts: AlertRow[];
  heatmap: HeatmapRow[];
  marketDataBanner: string | null;
  selectedTimeframe: Timeframe;
  setTicker: (ticker: string) => void;
  addWatch: (ticker: string) => void;
  removeWatch: (ticker: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  updateQuote: (quote: MarketQuote) => void;
  updateSignal: (signal: Opportunity) => void;
  updateAlert: (alert: AlertRow) => void;
  updateHeatmap: (rows: HeatmapRow[]) => void;
  setAlerts: (alerts: AlertRow[]) => void;
  showBanner: (message: string) => void;
  clearBanner: () => void;
};

export const useTickerStore = create<TickerStore>((set) => ({
  activeTicker: "",
  watchlist: [],
  quotes: {},
  signals: [],
  alerts: [],
  heatmap: [],
  marketDataBanner: null,
  selectedTimeframe: "1d",
  setTicker: (ticker) => set({ activeTicker: ticker.toUpperCase() }),
  addWatch: (ticker) =>
    set((state) => {
      const symbol = ticker.toUpperCase();
      if (state.watchlist.includes(symbol)) return state;
      return { watchlist: [symbol, ...state.watchlist] };
    }),
  removeWatch: (ticker) =>
    set((state) => ({ watchlist: state.watchlist.filter((item) => item !== ticker.toUpperCase()) })),
  setTimeframe: (timeframe) => set({ selectedTimeframe: timeframe }),
  updateQuote: (quote) =>
    set((state) => ({
      quotes: {
        ...state.quotes,
        [quote.symbol.toUpperCase()]: {
          ...quote,
          symbol: quote.symbol.toUpperCase(),
        },
      },
    })),
  updateSignal: (signal) =>
    set((state) => {
      const symbol = signal.symbol.toUpperCase();
      const strategy = signal.strategy;
      const next = [{ ...signal, symbol }, ...state.signals.filter((item) => !(item.symbol === symbol && item.strategy === strategy))];
      return { signals: next.slice(0, 200) };
    }),
  updateAlert: (alert) =>
    set((state) => {
      const exists = state.alerts.some((item) => item.id === alert.id);
      if (exists) return state;
      return {
        alerts: [alert, ...state.alerts].slice(0, 300),
      };
    }),
  updateHeatmap: (rows) => set({ heatmap: rows }),
  setAlerts: (alerts) => set({ alerts }),
  showBanner: (message) => set({ marketDataBanner: message }),
  clearBanner: () => set({ marketDataBanner: null }),
}));
