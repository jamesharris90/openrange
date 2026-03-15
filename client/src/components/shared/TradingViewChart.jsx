import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { authFetch } from '../../utils/api';

function parseCandles(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const data = root.data && typeof root.data === 'object' ? root.data : root;
  const candidates = [
    data.ohlc,
    data.candles,
    root.ohlc,
    root.candles,
  ];

  const rows = candidates.find((item) => Array.isArray(item)) || [];
  return rows
    .map((row) => {
      const timeValue = row?.time || row?.timestamp || row?.t;
      const epoch = Number(timeValue);
      const normalizedTime = Number.isFinite(epoch)
        ? Math.floor(epoch > 1e12 ? epoch / 1000 : epoch)
        : null;

      return {
        time: normalizedTime,
        open: Number(row?.open ?? row?.o),
        high: Number(row?.high ?? row?.h),
        low: Number(row?.low ?? row?.l),
        close: Number(row?.close ?? row?.c),
      };
    })
    .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.open) && Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.close));
}

export default function TradingViewChart({ symbol, height = 500, interval = '15' }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: Math.max(containerRef.current.clientWidth || 320, 1),
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.1)' },
        horzLines: { color: 'rgba(148,163,184,0.08)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { mode: 0 },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    const observer = new ResizeObserver((entries) => {
      const width = Math.max(entries?.[0]?.contentRect?.width || 320, 1);
      chart.applyOptions({ width });
    });
    observer.observe(containerRef.current);

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!seriesRef.current || !symbol) return;

      try {
        const params = new URLSearchParams({
          symbol: String(symbol).toUpperCase(),
          interval: String(interval),
        });

        const res = await authFetch(`/api/v5/chart?${params.toString()}`);
        if (!res.ok) throw new Error(`Chart request failed (${res.status})`);
        const payload = await res.json();
        const candles = parseCandles(payload);

        if (cancelled || !seriesRef.current) return;
        seriesRef.current.setData(candles);
        chartRef.current?.timeScale().fitContent();
        setFailed(candles.length === 0);
      } catch (_error) {
        if (!cancelled) {
          setFailed(true);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

  if (failed) {
    return (
      <div className="flex items-center justify-center rounded border border-slate-700/60 bg-slate-900/40 text-sm text-slate-300" style={{ height, width: '100%' }}>
        No chart data available
      </div>
    );
  }

  return <div ref={containerRef} style={{ height, width: '100%', borderRadius: 'var(--border-radius)', overflow: 'hidden' }} />;
}
