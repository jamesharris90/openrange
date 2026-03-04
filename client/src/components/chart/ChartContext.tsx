import { createContext, useContext } from 'react';

export const ChartContext = createContext({
  ticker: '',
  timeframe: '5min',
  chartRef: { current: null },
  candleSeriesRef: { current: null },
});

export function useChartContext() {
  return useContext(ChartContext);
}
