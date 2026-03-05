function formatValue(value, suffix = '', digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return `${number.toFixed(digits)}${suffix}`;
}

export default function MetricBar({ value, maxValue = 100, colorScheme = 'neutral', suffix = '', digits = 1 }) {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  const ratio = Math.max(0, Math.min(1, Math.abs(safeValue) / Math.max(1, maxValue)));

  const palettes = {
    green: 'rgba(34,197,94,0.8)',
    red: 'rgba(239,68,68,0.8)',
    blue: 'rgba(74,158,255,0.8)',
    neutral: 'rgba(148,163,184,0.75)',
  };

  const color = palettes[colorScheme] || palettes.neutral;

  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-[var(--bg-card-hover)]">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${ratio * 100}%`, background: color }}
        />
      </div>
      <span className="tabular-nums">{formatValue(value, suffix, digits)}</span>
    </div>
  );
}
