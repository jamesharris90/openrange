import { memo, useEffect, useRef } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import { apiJSON } from '../../config/api';

function normalize(values = []) {
  const nums = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (nums.length >= 2) return nums.slice(-20);
  return [50, 52, 51, 53, 54, 55, 56, 57, 58, 59, 58, 60, 61, 62, 61, 63, 64, 65, 66, 67];
}

function Sparkline({ symbol, points = [], width = undefined, height = 40, positive = true }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const containerWidth = containerRef.current.clientWidth || 120;
    const chart = createChart(containerRef.current, {
      width: width || containerWidth,
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: 'transparent',
      },
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
      color: positive ? '#34d399' : '#f87171',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      seriesRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [height, positive, width]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let source = normalize(points);
      if (symbol) {
        try {
          const payload = await apiJSON(`/api/cache/sparkline/${encodeURIComponent(symbol)}`);
          const apiPoints = (Array.isArray(payload) ? payload : [])
            .map((row) => Number(row?.value))
            .filter((v) => Number.isFinite(v));
          if (apiPoints.length >= 2) source = apiPoints.slice(-20);
        } catch {
          source = normalize(points);
        }
      }

      if (cancelled || !seriesRef.current) return;

      seriesRef.current.setData(source.map((value, index) => ({ time: index + 1, value })));
      chartRef.current?.timeScale().fitContent();
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [points, symbol]);

  return <div ref={containerRef} style={{ width: width || '100%', height: height || 40 }} aria-label="sparkline" />;
}

export default memo(Sparkline);
