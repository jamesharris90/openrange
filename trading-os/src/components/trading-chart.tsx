"use client";

import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

import { toFixedSafe } from "@/lib/number";

type TradingChartProps = {
  ticker: string;
};

function buildSeries() {
  const now = Math.floor(Date.now() / 1000);
  let price = 100 + Math.random() * 40;

  return Array.from({ length: 60 }).map((_, index) => {
    price += (Math.random() - 0.48) * 1.8;
    return {
      time: (now - (59 - index) * 60) as UTCTimestamp,
      value: Number(toFixedSafe(price, 2)),
    };
  });
}

export function TradingChart({ ticker }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#111827" },
        textColor: "#94A3B8",
      },
      grid: {
        vertLines: { color: "#1E293B" },
        horzLines: { color: "#1E293B" },
      },
      rightPriceScale: { borderColor: "#334155" },
      timeScale: { borderColor: "#334155", timeVisible: true },
      crosshair: {
        vertLine: { color: "#22D3EE", width: 1 },
        horzLine: { color: "#22D3EE", width: 1 },
      },
      autoSize: true,
    });

    const series: ISeriesApi<"Area"> = chart.addSeries(AreaSeries, {
      lineColor: "#22D3EE",
      topColor: "rgba(34, 211, 238, 0.35)",
      bottomColor: "rgba(34, 211, 238, 0.02)",
    });

    series.setData(buildSeries());

    const resizeObserver = new ResizeObserver(() => {
      chart.timeScale().fitContent();
    });

    resizeObserver.observe(containerRef.current);
    chart.timeScale().fitContent();

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [ticker]);

  return <div ref={containerRef} className="h-[280px] w-full" />;
}
