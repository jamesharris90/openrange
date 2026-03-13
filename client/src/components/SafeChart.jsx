import React from 'react';

export default function SafeChart({ data = [], renderChart, fallback }) {
  try {
    const points = Array.isArray(data) ? data : [];
    if (!points.length) {
      return fallback || <div className="rounded border p-3 text-sm text-gray-500">No chart data available</div>;
    }

    if (typeof renderChart === 'function') {
      return renderChart(points);
    }

    return (
      <div className="rounded border p-3 text-sm">
        <div>Simple Chart Fallback</div>
        <div>Points: {points.length}</div>
      </div>
    );
  } catch (_error) {
    return <div className="rounded border p-3 text-sm text-red-500">Chart failed. Fallback active.</div>;
  }
}
