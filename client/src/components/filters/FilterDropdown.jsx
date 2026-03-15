export default function FilterDropdown({ label, value, onChange, options = [], multi = false }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <select
        multiple={multi}
        value={value}
        onChange={(event) => {
          if (multi) {
            const values = [...event.target.selectedOptions].map((opt) => opt.value);
            onChange(values);
            return;
          }
          onChange(event.target.value);
        }}
        className="h-9 w-full rounded-md border border-slate-800 bg-slate-950 px-2 text-sm text-slate-100"
      >
        {!multi ? <option value="">All</option> : null}
        {options.map((option) => (
          <option key={option.value || option} value={option.value || option}>{option.label || option}</option>
        ))}
      </select>
    </label>
  );
}
