import React, { useEffect, useMemo, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';

import type { Candle, Indicators, Levels } from '../../context/symbol/types';
import type { QuotePayload } from '../../hooks/useCockpitData';

type CockpitChartProps = {
  candles: Candle[];
  indicators: Indicators;
  levels: Levels;
  quote: QuotePayload | null;
  timeframe: string;
};

function priceLineColor(value: number | undefined, fallback = 'rgba(148,163,184,0.9)') {
  return Number.isFinite(value) ? fallback : fallback;
}

export default function CockpitChart({ candles, indicators, levels, quote, timeframe }: CockpitChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ema9Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapRef = useRef<ISeriesApi<'Line'> | null>(null);

  const priceLineRefs = useRef<IPriceLine[]>([]);

  const latest = useMemo(() => {
    if (!candles.length) return null;
    return candles[candles.length - 1];
  }, [candles]);

  const isExecutionProfile = timeframe !== '1D';

  useEffect(() => {
    const root = containerRef.current;
    if (!root || chartRef.current) return;

    const style = getComputedStyle(document.documentElement);
    const bgSurface = style.getPropertyValue('--bg-surface').trim() || '#111827';
    const textPrimary = style.getPropertyValue('--text-primary').trim() || '#e5e7eb';
    const borderColor = style.getPropertyValue('--border-color').trim() || '#1f2937';

    const chart = createChart(root, {
      autoSize: true,
      layout: {
        background: { type: 'solid' as any, color: bgSurface },
        textColor: textPrimary,
      },
      grid: {
        vertLines: { color: borderColor },
        horzLines: { color: borderColor },
      },
      rightPriceScale: {
        borderColor,
        scaleMargins: { top: 0.05, bottom: 0.28 },
      },
      timeScale: {
        borderColor,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
      handleScale: true,
      handleScroll: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderVisible: false,
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const ema9 = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1 });
    const ema20 = chart.addSeries(LineSeries, { color: '#38bdf8', lineWidth: 1 });
    const ema50 = chart.addSeries(LineSeries, { color: '#22c55e', lineWidth: 1 });
    const vwap = chart.addSeries(LineSeries, { color: '#f97316', lineWidth: 2 });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    ema9Ref.current = ema9;
    ema20Ref.current = ema20;
    ema50Ref.current = ema50;
    vwapRef.current = vwap;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ema9Ref.current = null;
      ema20Ref.current = null;
      ema50Ref.current = null;
      vwapRef.current = null;
      priceLineRefs.current = [];
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    const sorted = [...candles].sort((a, b) => a.time - b.time);

    candleSeries.setData(
      sorted.map((candle) => ({
        time: candle.time as Time,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      })),
    );

    volumeSeries.setData(
      sorted.map((candle) => ({
        time: candle.time as Time,
        value: Number(candle.volume || 0),
        color: Number(candle.close) >= Number(candle.open) ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)',
      })),
    );

    chart.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    const sorted = [...candles].sort((a, b) => a.time - b.time);
    if (!sorted.length) return;

    const toSeriesFromValues = (values?: number[]) => {
      if (!Array.isArray(values) || !values.length) return [];
      const sanitized = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
      if (!sanitized.length) return [];
      const len = Math.min(sanitized.length, sorted.length);
      const candleOffset = sorted.length - len;
      const valueOffset = sanitized.length - len;
      return sanitized.slice(valueOffset).map((value, index) => ({
        time: sorted[candleOffset + index].time as Time,
        value,
      }));
    };

    const setSeries = (series: ISeriesApi<'Line'> | null, values?: number[]) => {
      if (!series) return;
      series.setData(toSeriesFromValues(values));
    };

    setSeries(ema9Ref.current, indicators.ema9);
    setSeries(ema20Ref.current, indicators.ema20);
    setSeries(ema50Ref.current, indicators.ema50);
    setSeries(vwapRef.current, indicators.vwap);

    ema9Ref.current?.applyOptions({ visible: isExecutionProfile });
    vwapRef.current?.applyOptions({ visible: isExecutionProfile });
    ema20Ref.current?.applyOptions({ visible: true });
    ema50Ref.current?.applyOptions({ visible: !isExecutionProfile });

    priceLineRefs.current.forEach((line) => {
      if (!candleSeriesRef.current) return;
      try {
        candleSeriesRef.current.removePriceLine(line);
      } catch (_error) {
      }
    });
    priceLineRefs.current = [];

    const createLevel = (value: number | undefined, title: string, color: string) => {
      if (!candleSeriesRef.current || !Number.isFinite(Number(value))) return;
      const line = candleSeriesRef.current.createPriceLine({
        price: Number(value),
        title,
        color: priceLineColor(value, color),
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
      });
      priceLineRefs.current.push(line);
    };

    createLevel(levels.pdh, 'PDH', '#60a5fa');
    createLevel(levels.pdl, 'PDL', '#f97316');
    createLevel(levels.pmh, 'PMH', '#22c55e');
    createLevel(levels.pml, 'PML', '#ef4444');
  }, [candles, indicators, levels, isExecutionProfile]);

  const latestAtr = Array.isArray(indicators?.atr14) && indicators.atr14.length
    ? indicators.atr14[indicators.atr14.length - 1]
    : null;

  return (
    <div className="relative h-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-2">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
        <span>Adaptive Chart</span>
        <span>{isExecutionProfile ? 'Execution Profile' : 'Trend Profile'}</span>
      </div>
      <div className="absolute right-3 top-8 z-20 rounded bg-[var(--bg-input)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
        <span className="mr-2">ATR: {latestAtr != null ? Number(latestAtr).toFixed(2) : '—'}</span>
        <span className="mr-2">RVOL: {quote?.rvol != null ? Number(quote.rvol).toFixed(2) : '—'}</span>
        <span>Move: {quote?.changePercent != null ? Number(quote.changePercent).toFixed(2) : '—'}%</span>
      </div>
      <div ref={containerRef} className="h-[calc(100%-18px)] w-full" />
      {!latest && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-[var(--text-secondary)]">No chart data</div>
      )}
    </div>
  );
}
