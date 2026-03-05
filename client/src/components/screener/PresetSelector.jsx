import { useMemo } from 'react';

const PRESETS = [
  { key: 'none', label: 'Custom' },
  { key: 'top-gainers', label: 'Top Gainers' },
  { key: 'top-losers', label: 'Top Losers' },
  { key: 'gap-up', label: 'Gap Up' },
  { key: 'gap-down', label: 'Gap Down' },
  { key: 'high-rvol', label: 'High RVOL' },
  { key: 'low-float-momentum', label: 'Low Float Momentum' },
  { key: 'pre-market-movers', label: 'Pre-Market Movers' },
  { key: 'post-earnings-movers', label: 'Post-Earnings Movers' },
  { key: 'high-expected-move', label: 'High Expected Move' },
  { key: 'catalyst-technical', label: 'Catalyst + Technical' },
];

export default function PresetSelector({ value, onChange }) {
  const options = useMemo(() => PRESETS, []);

  return (
    <label className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Preset</span>
      <select
        className="input-field h-10 min-w-[190px]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export { PRESETS };
