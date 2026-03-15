export default function FilterTagSelector({ label, value = [], onChange, options = [] }) {
  const selected = new Set(value);

  function toggle(tag) {
    const next = new Set(selected);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    onChange([...next]);
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-300">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={`rounded-full border px-2 py-1 text-xs ${selected.has(tag)
              ? 'border-blue-500/40 bg-blue-500/20 text-blue-300'
              : 'border-slate-800 bg-slate-950 text-slate-300'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  );
}
