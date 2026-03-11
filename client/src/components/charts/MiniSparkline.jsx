import { useEffect, useRef } from 'react';
import { AreaSeries, createChart } from 'lightweight-charts';
import { apiJSON } from '../../config/api';

function normalizePoints(points = []) {
  if (!Array.isArray(points)) return [];
  return points
    .map((row, index) => {
      if (typeof row === 'number') {
        return { time: index + 1, value: row };
      }
      return {
        time: Number(row?.time),
        value: Number(row?.value),
      };
    })
    .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.value));
}

export default function MiniSparkline({ symbol, points = [], height = 60 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const chart = createChart(containerRef.current, {
      width: Math.max(containerRef.current.clientWidth || 160, 1),
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderVisible: false },
      crosshair: { mode: 0 },
      handleScale: false,
      handleScroll: false,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#22c55e',
      topColor: 'rgba(34,197,94,0.5)',
      bottomColor: 'rgba(34,197,94,0)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const resizeObserver = new ResizeObserver((entries) => {
      const width = Math.max(entries?.[0]?.contentRect?.width || 160, 1);
      chart.applyOptions({ width });
    });

    resizeObserver.observe(containerRef.current);
    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      let data = normalizePoints(points);

      if (symbol) {
        try {
          const payload = await apiJSON(`/api/chart/sparkline?symbol=${encodeURIComponent(symbol)}`);
          const remote = normalizePoints(payload);
          if (remote.length > 1) data = remote;
        } catch (_error) {
          // Fall back to provided points.
        }
      }

      if (cancelled || !seriesRef.current) return;
      if (!data.length) {
        seriesRef.current.setData([]);
        return;
      }

      const rising = Number(data[data.length - 1]?.value || 0) >= Number(data[0]?.value || 0);
      seriesRef.current.applyOptions({
        lineColor: rising ? '#22c55e' : '#ef4444',
        topColor: rising ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)',
        bottomColor: rising ? 'rgba(34,197,94,0)' : 'rgba(239,68,68,0)',
      });

      seriesRef.current.setData(data);
      chartRef.current?.timeScale().fitContent();
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [symbol, points]);

  return <div ref={containerRef} style={{ width: '100%', height }} aria-label="mini-sparkline" />;
}
