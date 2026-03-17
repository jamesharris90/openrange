import { ChartEngine } from "@/components/charts/chart-engine";

export function TradingChart({ ticker, timeframe }: { ticker: string; timeframe: "daily" | "5m" | "1m" }) {
  return <ChartEngine ticker={ticker} timeframe={timeframe} />;
}
