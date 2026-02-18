import { useState } from 'react';
import { X, Save } from 'lucide-react';

const STORAGE_KEY = 'aiq-custom-strategies';

const FILTER_DEFS = [
  { id: 'avgVol', label: 'Avg Volume', type: 'select', options: [
    { label: '> 200K', value: 'sh_avgvol_o200' }, { label: '> 500K', value: 'sh_avgvol_o500' },
    { label: '> 1M', value: 'sh_avgvol_o1000' }, { label: '> 2M', value: 'sh_avgvol_o2000' },
  ]},
  { id: 'change', label: 'Change%', type: 'select', options: [
    { label: '> 1%', value: 'ta_change_u1' }, { label: '> 3%', value: 'ta_change_u3' },
    { label: '> 5%', value: 'ta_change_u5' }, { label: '> 10%', value: 'ta_change_u10' },
  ]},
  { id: 'gap', label: 'Gap%', type: 'select', options: [
    { label: '> 1%', value: 'ta_gap_u1' }, { label: '> 3%', value: 'ta_gap_u3' },
    { label: '> 5%', value: 'ta_gap_u5' },
  ]},
  { id: 'rvol', label: 'Rel Volume', type: 'select', options: [
    { label: '> 1', value: 'sh_relvol_o1' }, { label: '> 1.5', value: 'sh_relvol_o1.5' },
    { label: '> 2', value: 'sh_relvol_o2' }, { label: '> 3', value: 'sh_relvol_o3' },
  ]},
  { id: 'sma20', label: 'Above SMA 20', type: 'toggle', value: 'ta_sma20_pa' },
  { id: 'sma50', label: 'Above SMA 50', type: 'toggle', value: 'ta_sma50_pa' },
  { id: 'sma200', label: 'Above SMA 200', type: 'toggle', value: 'ta_sma200_pa' },
  { id: 'rsi', label: 'RSI', type: 'select', options: [
    { label: '> 50', value: 'ta_rsi_nos50' }, { label: 'Overbought (> 70)', value: 'ta_rsi_ob70' },
    { label: 'Oversold (< 30)', value: 'ta_rsi_os30' },
  ]},
  { id: 'float', label: 'Float', type: 'select', options: [
    { label: '< 20M', value: 'sh_float_u20' }, { label: '< 50M', value: 'sh_float_u50' },
    { label: '< 100M', value: 'sh_float_u100' },
  ]},
  { id: 'short', label: 'Short Float', type: 'select', options: [
    { label: '> 5%', value: 'sh_short_o5' }, { label: '> 10%', value: 'sh_short_o10' },
    { label: '> 20%', value: 'sh_short_o20' },
  ]},
  { id: 'near52wh', label: 'Near 52W High', type: 'toggle', value: 'ta_highlow52w_nh' },
];

const WEIGHT_FIELDS = [
  { id: 'gapChange', label: 'Gap/Change' },
  { id: 'volume', label: 'Volume (RVOL + Avg Vol)' },
  { id: 'technical', label: 'Technical (RSI + SMA)' },
  { id: 'proximity', label: 'Proximity (52W + Trend)' },
];

export function loadCustomStrategies() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomStrategies(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export default function CustomStrategyBuilder({ onClose, onSave, editing }) {
  const [name, setName] = useState(editing?.name || '');
  const [filterState, setFilterState] = useState(() => {
    if (editing?.filters) {
      const state = {};
      for (const f of FILTER_DEFS) {
        if (f.type === 'toggle') {
          state[f.id] = editing.filters.includes(f.value);
        } else {
          state[f.id] = editing.filters.find(v => f.options?.some(o => o.value === v)) || '';
        }
      }
      return state;
    }
    return {};
  });
  const [weights, setWeights] = useState(editing?.weights || { gapChange: 25, volume: 25, technical: 25, proximity: 25 });

  const toggleFilter = (id) => setFilterState(prev => ({ ...prev, [id]: !prev[id] }));
  const setSelectFilter = (id, val) => setFilterState(prev => ({ ...prev, [id]: val }));
  const setWeight = (id, val) => {
    const num = Math.max(0, Math.min(100, parseInt(val) || 0));
    setWeights(prev => ({ ...prev, [id]: num }));
  };

  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);

  const buildFilterString = () => {
    const parts = [];
    for (const f of FILTER_DEFS) {
      if (f.type === 'toggle' && filterState[f.id]) parts.push(f.value);
      else if (f.type === 'select' && filterState[f.id]) parts.push(filterState[f.id]);
    }
    return parts;
  };

  const handleSave = () => {
    if (!name.trim()) return;
    if (weightSum !== 100) return;
    const filters = buildFilterString();
    if (filters.length === 0) return;
    const strategy = {
      id: editing?.id || `custom-${Date.now()}`,
      name: name.trim(),
      filters,
      filterString: filters.join(','),
      weights,
      createdAt: editing?.createdAt || new Date().toISOString(),
    };
    const existing = loadCustomStrategies();
    const idx = existing.findIndex(s => s.id === strategy.id);
    if (idx >= 0) existing[idx] = strategy;
    else existing.push(strategy);
    saveCustomStrategies(existing);
    onSave?.(strategy);
    onClose?.();
  };

  return (
    <div className="aiq-modal-backdrop" onClick={onClose}>
      <div className="aiq-modal aiq-csb" onClick={e => e.stopPropagation()}>
        <div className="aiq-modal__header">
          <h3>{editing ? 'Edit' : 'New'} Custom Strategy</h3>
          <button className="aiq-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="aiq-csb__body">
          {/* Name */}
          <div className="aiq-csb__field">
            <label>Strategy Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Low Float Gappers" className="aiq-input" maxLength={30} />
          </div>

          {/* Filters */}
          <div className="aiq-csb__section">
            <div className="aiq-csb__section-title">Screening Filters</div>
            <div className="aiq-csb__filters">
              {FILTER_DEFS.map(f => (
                <div key={f.id} className="aiq-csb__filter-row">
                  <span className="aiq-csb__filter-label">{f.label}</span>
                  {f.type === 'toggle' ? (
                    <button className={`aiq-csb__toggle ${filterState[f.id] ? 'active' : ''}`}
                      onClick={() => toggleFilter(f.id)}>
                      {filterState[f.id] ? 'ON' : 'OFF'}
                    </button>
                  ) : (
                    <select className="aiq-select aiq-select--sm" value={filterState[f.id] || ''}
                      onChange={e => setSelectFilter(f.id, e.target.value)}>
                      <option value="">Off</option>
                      {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Weights */}
          <div className="aiq-csb__section">
            <div className="aiq-csb__section-title">
              Scoring Weights
              <span className={`aiq-csb__weight-sum ${weightSum === 100 ? 'valid' : 'invalid'}`}>
                Sum: {weightSum}/100
              </span>
            </div>
            <div className="aiq-csb__weights">
              {WEIGHT_FIELDS.map(w => (
                <div key={w.id} className="aiq-csb__weight-row">
                  <label>{w.label}</label>
                  <input type="range" min="0" max="100" step="5" value={weights[w.id]}
                    onChange={e => setWeight(w.id, e.target.value)} />
                  <span className="aiq-csb__weight-val">{weights[w.id]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="aiq-modal__footer">
          <button className="aiq-btn" onClick={onClose}>Cancel</button>
          <button className="aiq-btn aiq-btn--primary" onClick={handleSave}
            disabled={!name.trim() || weightSum !== 100 || buildFilterString().length === 0}>
            <Save size={14} /> {editing ? 'Update' : 'Create'} Strategy
          </button>
        </div>
      </div>
    </div>
  );
}
