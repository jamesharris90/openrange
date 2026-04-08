"use client";

import { memo, useEffect, useRef } from "react";
import { AreaSeries, ColorType, UTCTimestamp, createChart } from "lightweight-charts";

export const Sparkline = memo(function Sparkline({
  values,
  width = 120,
  height = 34,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.innerHTML = "";
    const chart = createChart(host, {
      width,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
      },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderVisible: false },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      handleScale: false,
      handleScroll: false,
      crosshair: {
        vertLine: { visible: false },
        horzLine: { visible: false },
      },
    });

    const up = values[values.length - 1] >= values[0];
    const color = up ? "#16c784" : "#ea3943";
    const series = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: up ? "rgba(22, 199, 132, 0.25)" : "rgba(234, 57, 67, 0.25)",
      bottomColor: "rgba(0, 0, 0, 0)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const data = values.map((value, index) => ({ time: (index + 1) as UTCTimestamp, value }));
    series.setData(data);

    return () => {
      chart.remove();
    };
  }, [values, width, height]);

  return (
    <div ref={hostRef} style={{ width, height }} aria-label="Sparkline" />
  );
});
