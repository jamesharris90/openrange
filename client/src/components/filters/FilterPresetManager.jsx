import { useState } from 'react';

export default function FilterPresetManager({ presets = [], onSave, onLoad, onDelete }) {
  const [name, setName] = useState('');

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Filter Presets</p>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Preset name"
          className="h-9 flex-1 rounded-md border border-slate-800 bg-slate-900 px-2 text-sm text-slate-100"
        />
        <button
          type="button"
          onClick={() => {
            onSave(name);
            setName('');
          }}
          className="h-9 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200"
        >
          Save
        </button>
      </div>
      <div className="space-y-1">
        {presets.map((preset) => (
          <div key={preset.id} className="flex items-center justify-between rounded border border-slate-800 bg-slate-900 px-2 py-1.5">
            <button type="button" onClick={() => onLoad(preset.id)} className="text-xs text-slate-200">{preset.name}</button>
            <button type="button" onClick={() => onDelete(preset.id)} className="text-xs text-red-400">Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
