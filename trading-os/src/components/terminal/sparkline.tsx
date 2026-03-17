"use client";

import { memo, useMemo } from "react";

export const Sparkline = memo(function Sparkline({
  values,
  width = 120,
  height = 34,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const path = useMemo(() => {
    if (!values.length) return "";
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = Math.max(max - min, 0.001);

    return values
      .map((value, index) => {
        const x = (index / Math.max(values.length - 1, 1)) * width;
        const y = height - ((value - min) / range) * height;
        return `${index === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  }, [values, width, height]);

  const up = values[values.length - 1] >= values[0];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="Sparkline">
      <path d={path} fill="none" stroke={up ? "#16c784" : "#ea3943"} strokeWidth="2" />
    </svg>
  );
});
