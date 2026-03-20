"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  CandlestickSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";

import { getMarketChart } from "@/lib/api/markets";
import { toFixedSafe } from "@/lib/number";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";
import { useTickerStore } from "@/lib/store/ticker-store";
import type { PricePoint } from "@/lib/types";

function toUnix(value: string | number): UTCTimestamp {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) {
      return Math.floor(value / 1000) as UTCTimestamp;
    }
    return Math.floor(value) as UTCTimestamp;
  }

  const parsedMs = Date.parse(String(value || ""));
  if (Number.isFinite(parsedMs)) {
    return Math.floor(parsedMs / 1000) as UTCTimestamp;
  }

  return Math.floor(Date.now() / 1000) as UTCTimestamp;
}

function ema(values: number[], period: number) {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let last = values[0] ?? 0;
  for (const value of values) {
    last = value * k + last * (1 - k);
    out.push(last);
  }
  return out;
}

function vwap(points: PricePoint[]) {
  let cumulativePV = 0;
  let cumulativeVolume = 0;
  return points.map((point) => {
    const close = Number(point.close || 0);
    const volume = Number(point.volume || 0);
    cumulativePV += close * volume;
    cumulativeVolume += volume;
    return cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : close;
  });
}

export function ChartEngine({
  ticker,
  timeframe,
  height = 260,
  gammaExposure = 0,
}: {
  ticker: string;
  timeframe: "daily" | "5m" | "1m";
  height?: number;
  gammaExposure?: number;
}) {
  const liveQuote = useTickerStore((state) => state.quotes[ticker.toUpperCase()]);
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    candles: ReturnType<IChartApi["addSeries"]> | null;
    vwap: ReturnType<IChartApi["addSeries"]> | null;
    ema9: ReturnType<IChartApi["addSeries"]> | null;
    ema20: ReturnType<IChartApi["addSeries"]> | null;
    ema50: ReturnType<IChartApi["addSeries"]> | null;
    volume: ReturnType<IChartApi["addSeries"]> | null;
    gamma: ReturnType<IChartApi["addSeries"]> | null;
  }>({
    candles: null,
    vwap: null,
    ema9: null,
    ema20: null,
    ema50: null,
    volume: null,
    gamma: null,
  });

  const { data = [] } = useQuery({
    queryKey: queryKeys.chart(ticker, timeframe),
    queryFn: () => getMarketChart(ticker, timeframe),
    ...QUERY_POLICY.fast,
  });

  const normalized = useMemo(() => {
    return data;
  }, [data]);

  useEffect(() => {
    if (!ref.current) return;

    const chart = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#121826" },
        textColor: "#cbd5e1",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      width: ref.current.clientWidth,
      height,
      rightPriceScale: { borderColor: "#1e293b" },
      timeScale: { borderColor: "#1e293b", timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: "#3b82f6", width: 1 },
        horzLine: { color: "#3b82f6", width: 1 },
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#16c784",
      downColor: "#ea3943",
      borderVisible: false,
      wickUpColor: "#16c784",
      wickDownColor: "#ea3943",
    });

    const vwapSeries = chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 2 });
    const ema9Series = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1 });
    const ema20Series = chart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 1 });
    const ema50Series = chart.addSeries(LineSeries, { color: "#22d3ee", lineWidth: 1 });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: "rgba(59,130,246,0.4)",
    });

    const gammaSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "left",
      color: "rgba(245,158,11,0.45)",
    });

    candles.priceScale().applyOptions({
      autoScale: true,
    });

    seriesRef.current = {
      candles,
      vwap: vwapSeries,
      ema9: ema9Series,
      ema20: ema20Series,
      ema50: ema50Series,
      volume: volumeSeries,
      gamma: gammaSeries,
    };

    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      if (!ref.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: ref.current.clientWidth });
    });

    resizeObserver.observe(ref.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = {
        candles: null,
        vwap: null,
        ema9: null,
        ema20: null,
        ema50: null,
        volume: null,
        gamma: null,
      };
    };
  }, [height]);

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current.candles) return;

    const chart = chartRef.current;
    const candles = seriesRef.current.candles;
    const vwapSeries = seriesRef.current.vwap;
    const ema9Series = seriesRef.current.ema9;
    const ema20Series = seriesRef.current.ema20;
    const ema50Series = seriesRef.current.ema50;
    const volumeSeries = seriesRef.current.volume;
    const gammaSeries = seriesRef.current.gamma;

    const candleRows = normalized.map((point) => ({
      time: toUnix(point.time),
      open: Number(point.open ?? point.close),
      high: Number(point.high ?? point.close),
      low: Number(point.low ?? point.close),
      close: Number(point.close),
    }));

    console.log("CHART RAW DATA:", normalized.slice(0, 5));
    console.log("CHART MAPPED DATA:", candleRows.slice(0, 5));

    const closeValues = normalized.map((point) => Number(point.close));
    const vwapValues = vwap(normalized);
    const ema9 = ema(closeValues, 9);
    const ema20 = ema(closeValues, 20);
    const ema50 = ema(closeValues, 50);

    const lineRows = normalized.map((point, idx) => ({
      time: toUnix(point.time),
      value: Number(point.close),
      idx,
    }));

    candles?.setData(candleRows);
    vwapSeries?.setData(lineRows.map((row) => ({ time: row.time, value: vwapValues[row.idx] || row.value })));
    ema9Series?.setData(lineRows.map((row) => ({ time: row.time, value: ema9[row.idx] || row.value })));
    ema20Series?.setData(lineRows.map((row) => ({ time: row.time, value: ema20[row.idx] || row.value })));
    ema50Series?.setData(lineRows.map((row) => ({ time: row.time, value: ema50[row.idx] || row.value })));
    volumeSeries?.setData(
      normalized.map((point) => ({
        time: toUnix(point.time),
        value: Number(point.volume || 0),
        color: Number(point.close) >= Number(point.open ?? point.close) ? "rgba(22,199,132,0.45)" : "rgba(234,57,67,0.45)",
      }))
    );

    const gexValue = Number.isFinite(Number(gammaExposure)) ? Number(gammaExposure) : 0;
    gammaSeries?.setData(
      normalized.map((point) => {
        const open = Number(point.open ?? point.close);
        const close = Number(point.close);
        const drift = open !== 0 ? (close - open) / Math.abs(open) : 0;
        const signed = gexValue !== 0 ? gexValue * (1 + drift) : (close - open) * 10;

        return {
          time: toUnix(point.time),
          value: signed,
          color: signed >= 0 ? "rgba(22,199,132,0.40)" : "rgba(234,57,67,0.40)",
        };
      })
    );

    chart.timeScale().fitContent();
  }, [normalized, gammaExposure]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-2 shadow-lg">
      <div className="mb-2 flex items-center justify-between px-2 text-xs text-slate-400">
        <span className="font-mono">{ticker}</span>
        <span className="flex items-center gap-2 uppercase">
          <span>{timeframe}</span>
          {liveQuote ? (() => {
            const livePrice = Number(liveQuote.price);
            const liveChange = Number(liveQuote.change_percent);
            const hasLivePrice = Number.isFinite(livePrice);
            const hasLiveChange = Number.isFinite(liveChange);

            if (!hasLivePrice) {
              return <span className="text-slate-500">No live price</span>;
            }

              return (
                <span className={hasLiveChange && liveChange < 0 ? "text-bear" : "text-bull"}>
                  ${toFixedSafe(livePrice, 2)}
                </span>
              );
          })() : null}
        </span>
      </div>
      <div ref={ref} className="w-full" />
      {normalized.length === 0 && <div className="px-2 pb-2 text-xs text-slate-500">No OHLC data available.</div>}
    </div>
  );
}
