import { createContext, useContext } from 'react';

export const ChartContext = createContext({
  ticker: 'AAPL',
  timeframe: '5min',
  chartRef: { current: null },
  candleSeriesRef: { current: null },
});

export function useChartContext() {
  return useContext(ChartContext);
}
