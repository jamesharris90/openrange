import { useMemo } from 'react';

function normalizePoints(points) {
  if (!Array.isArray(points) || points.length < 2) return [50, 52, 49, 54, 58, 55, 60];
  const numbers = points.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  return numbers.length >= 2 ? numbers : [50, 52, 49, 54, 58, 55, 60];
}

export default function SparklineMini({ points, width = 80, height = 24, positive = true }) {
  const { line, area, stroke } = useMemo(() => {
    const safePoints = normalizePoints(points);
    const max = Math.max(...safePoints);
    const min = Math.min(...safePoints);
    const span = max - min || 1;

    const coords = safePoints.map((point, index) => {
      const x = (index / (safePoints.length - 1)) * width;
      const y = height - ((point - min) / span) * (height - 2) - 1;
      return [x, y];
    });

    const linePath = coords.map(([x, y]) => `${x},${y}`).join(' ');
    const areaPath = `${linePath} ${width},${height} 0,${height}`;

    return {
      line: linePath,
      area: areaPath,
      stroke: positive ? 'var(--positive)' : 'var(--negative)',
    };
  }, [height, points, positive, width]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="sparkline">
      <defs>
        <linearGradient id={`spark-fill-${positive ? 'up' : 'down'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <polyline fill={`url(#spark-fill-${positive ? 'up' : 'down'})`} stroke="none" points={area} />
      <polyline fill="none" stroke={stroke} strokeWidth="1.6" points={line} />
    </svg>
  );
}
