import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import { apiJSON } from '../../config/api';

function normalizePoints(points) {
  if (!Array.isArray(points) || points.length < 2) return [50, 52, 49, 54, 58, 55, 60];
  const numbers = points?.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  return numbers.length >= 2 ? numbers : [50, 52, 49, 54, 58, 55, 60];
}

function buildFromCandles(candles) {
  const values = (Array.isArray(candles) ? candles : [])
    ?.map((candle) => Number(candle?.close))
    .filter((value) => Number.isFinite(value));
  return values.length >= 2 ? values.slice(-80) : null;
}

function buildFromMiniSeries(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  const values = rows
    ?.map((row) => Number(row?.value))
    .filter((value) => Number.isFinite(value));
  return values.length >= 2 ? values.slice(-80) : null;
}

export default function SparklineMini({ points, symbol, width = 84, height = 24, positive = true }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const [chartFailed, setChartFailed] = useState(false);

  const fallbackPoints = useMemo(() => normalizePoints(points), [points]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    try {
      const chart = createChart(el, {
        width,
        height,
        layout: { background: { color: 'transparent' }, textColor: 'transparent' },
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: false },
        },
        rightPriceScale: { visible: false },
        leftPriceScale: { visible: false },
        timeScale: { visible: false, borderVisible: false },
        crosshair: {
          vertLine: { visible: false },
          horzLine: { visible: false },
        },
        handleScale: false,
        handleScroll: false,
      });

      const series = chart.addSeries(LineSeries, {
        color: positive ? 'rgba(16,185,129,0.95)' : 'rgba(239,68,68,0.95)',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      chartRef.current = chart;
      seriesRef.current = series;
      setChartFailed(false);
    } catch (err) {
      console.error('Chart initialization failed', err);
      chartRef.current = null;
      seriesRef.current = null;
      setChartFailed(true);
    }

    return () => {
      seriesRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [height, positive, width]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!seriesRef.current) return;

      let source = fallbackPoints;
      if (symbol) {
        try {
          const payload = await apiJSON(`/api/market/chart-mini/${encodeURIComponent(symbol)}`);
          const fromApi = buildFromMiniSeries(payload) || buildFromCandles(payload?.candles);
          if (fromApi) source = fromApi;
        } catch (_error) {
          source = fallbackPoints;
        }
      }

      if (cancelled || !seriesRef.current) return;

      seriesRef.current.setData(
        source?.map((value, index) => ({
          time: index + 1,
          value,
        }))
      );
      chartRef.current?.timeScale().fitContent();
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [fallbackPoints, symbol]);

  if (chartFailed) {
    return (
      <div
        style={{ width, height, fontSize: 10, lineHeight: `${height}px`, textAlign: 'center', color: 'var(--text-muted, #94a3b8)' }}
        aria-label="sparkline-fallback"
      >
        Chart temporarily unavailable
      </div>
    );
  }

  return <div ref={containerRef} style={{ width, height }} aria-label="sparkline" />;
}
