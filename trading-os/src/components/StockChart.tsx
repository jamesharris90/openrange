"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, LineStyle, AreaSeries, UTCTimestamp } from "lightweight-charts";

// ── types ──────────────────────────────────────────────────────────────────────

export type StockChartProps = {
  symbol: string;
  currentPrice?: number;
  changePct?: number;
};

type Bar = {
  time: UTCTimestamp;
  value: number;
};

// ── component ─────────────────────────────────────────────────────────────────

export function StockChart({ symbol, currentPrice = 0, changePct = 0 }: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bars,   setBars]   = useState<Bar[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty">("loading");

  useEffect(() => {
    if (!symbol) { setStatus("empty"); return; }
    setStatus("loading");

    fetch(`/api/ohlc/intraday?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(json => {
        const rows: Array<{ timestamp?: string; close?: unknown; open?: unknown }> = json?.data ?? [];
        const parsed: Bar[] = rows
          .map(r => {
            if (!r.timestamp) return null;
            const ms = new Date(r.timestamp).getTime();
            if (!Number.isFinite(ms)) return null;
            const val = Number(r.close ?? r.open ?? 0);
            if (!Number.isFinite(val) || val <= 0) return null;
            return { time: Math.floor(ms / 1000) as UTCTimestamp, value: val };
          })
          .filter((x): x is Bar => x !== null);

        // Deduplicate by time (keep last) and sort ascending
        const seen = new Map<number, Bar>();
        for (const b of parsed) seen.set(b.time as number, b);
        const deduped = Array.from(seen.values()).sort((a, b) => (a.time as number) - (b.time as number));

        setBars(deduped);
        setStatus(deduped.length > 0 ? "ready" : "empty");
      })
      .catch(() => setStatus("empty"));
  }, [symbol]);

  const lineColor   = changePct >= 0 ? "#4fd1c5" : "#f87171";
  const topColor    = changePct >= 0 ? "rgba(79,209,197,0.22)"  : "rgba(248,113,113,0.22)";
  const bottomColor = changePct >= 0 ? "rgba(79,209,197,0)"     : "rgba(248,113,113,0)";

  useEffect(() => {
    const el = containerRef.current;
    if (!el || status !== "ready" || bars.length === 0) return;

    const chart = createChart(el, {
      width:  el.clientWidth,
      height: 300,
      layout: {
        background:  { type: ColorType.Solid, color: "transparent" },
        textColor:   "rgba(148,163,184,0.8)",
        fontFamily:  "'Inter','ui-sans-serif',system-ui,sans-serif",
        fontSize:    11,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.05)" },
        horzLines: { color: "rgba(148,163,184,0.05)" },
      },
      crosshair: {
        vertLine: { color: "rgba(148,163,184,0.4)", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1e293b" },
        horzLine: { color: "rgba(148,163,184,0.4)", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1e293b" },
      },
      rightPriceScale: {
        borderColor:  "rgba(148,163,184,0.1)",
        textColor:    "rgba(148,163,184,0.65)",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor:    "rgba(148,163,184,0.1)",
        timeVisible:    true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale:  true,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor,
      topColor,
      bottomColor,
      lineWidth:        2,
      lastValueVisible: true,
      priceLineVisible: false,
    });

    series.setData(bars);

    // Current price dashed reference line
    if (currentPrice > 0) {
      series.createPriceLine({
        price:              currentPrice,
        color:              "rgba(148,163,184,0.45)",
        lineWidth:          1,
        lineStyle:          LineStyle.Dashed,
        axisLabelVisible:   false,
        title:              "",
      });
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (el) chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); };
  }, [bars, status, lineColor, topColor, bottomColor, currentPrice]);

  if (status === "loading") {
    return (
      <div className="w-full bg-[var(--muted)] animate-pulse" style={{ height: 300 }} />
    );
  }

  if (status === "empty") {
    return (
      <div className="w-full flex items-center justify-center border-b border-[var(--border)]" style={{ height: 240 }}>
        <div className="text-center space-y-1">
          <p className="text-sm text-[var(--muted-foreground)]">Intraday chart not available</p>
          <p className="text-[11px] text-[var(--muted-foreground)]/50">Data populates during market hours</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute top-3 left-3 z-10 pointer-events-none">
        <span className="text-[11px] font-mono font-semibold text-slate-400/60 tracking-widest uppercase">
          {symbol} · 1m Intraday
        </span>
      </div>
      <div ref={containerRef} className="w-full" style={{ height: 300 }} />
    </div>
  );
}
