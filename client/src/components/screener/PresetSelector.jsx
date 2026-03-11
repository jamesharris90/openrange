import { useMemo } from 'react';

export default function PresetSelector({ value, onChange, presets = [] }) {
  const options = useMemo(
    () => [{ key: 'none', label: 'Custom' }, ...presets],
    [presets]
  );

  return (
    <label className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Preset</span>
      <select
        className="input-field h-10 min-w-[190px]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options?.map((option) => (
          <option key={option.key} value={option.key}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
