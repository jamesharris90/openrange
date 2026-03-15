export default function FilterRangeSlider({ label, value, onChange, min = 0, max = 100, step = 1 }) {
  const range = value || { min: '', max: '' };

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-300">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={range.min}
          onChange={(event) => onChange({ ...range, min: event.target.value })}
          placeholder="Min"
          className="h-9 rounded-md border border-slate-800 bg-slate-950 px-2 text-sm text-slate-100"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={range.max}
          onChange={(event) => onChange({ ...range, max: event.target.value })}
          placeholder="Max"
          className="h-9 rounded-md border border-slate-800 bg-slate-950 px-2 text-sm text-slate-100"
        />
      </div>
    </div>
  );
}
