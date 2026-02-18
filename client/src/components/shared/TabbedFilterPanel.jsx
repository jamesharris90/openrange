import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, Filter as FilterIcon, Save, FolderOpen, ChevronDown, Search, Zap } from 'lucide-react';
import {
  FILTER_TABS,
  FILTER_DEFINITIONS,
  CATALYST_OPTIONS,
  STRATEGY_PRESETS,
  buildFilterDefaults,
} from '../../features/news/FilterConfigs';

const PRESETS_KEY = 'screener-presets';

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; } catch { return []; }
}
function savePresets(list) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch {}
}

/* Multi-select dropdown component */
function MultiSelectDropdown({ def, values, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = Array.isArray(values) ? values : [];

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function toggle(val) {
    const next = selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val];
    onChange(next);
  }

  return (
    <div className="form-field" ref={ref}>
      <label>{def.label}</label>
      <button type="button" className="multiselect-trigger" onClick={() => setOpen(o => !o)}>
        <span>{selected.length > 0 ? `${def.label} (${selected.length})` : 'Any'}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="multiselect-dropdown">
          {(def.options || []).map(opt => (
            <label key={opt.value} className="multiselect-option">
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} />
              {opt.label}
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" className="multiselect-clear" onClick={() => onChange([])}>Clear All</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TabbedFilterPanel({
  filters,
  setFilters,
  tabs,
  extraControls,
  collapsed,
  setCollapsed,
  onApply,
  onClear,
  showActionButtons = false,
  onTogglePanel,
}) {
  const [activeTab, setActiveTab] = useState(() => {
    const available = tabs || FILTER_TABS.map(t => t.id);
    return available.includes('descriptive') ? 'descriptive' : available[0];
  });
  const [presets, setPresets] = useState(loadPresets);
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [showStrategyPresets, setShowStrategyPresets] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const presetRef = useRef(null);
  const strategyRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (presetRef.current && !presetRef.current.contains(e.target)) setShowPresetMenu(false);
      if (strategyRef.current && !strategyRef.current.contains(e.target)) setShowStrategyPresets(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const visibleTabs = useMemo(() => {
    if (!tabs) return FILTER_TABS;
    return FILTER_TABS.filter(t => tabs.includes(t.id));
  }, [tabs]);

  const activeCount = useMemo(() => {
    return Object.entries(filters).filter(([, v]) => {
      if (Array.isArray(v)) return v.length > 0;
      return v !== '' && v != null;
    }).length;
  }, [filters]);

  function getVisibleFilters(tabId) {
    let defs;
    if (tabId === 'all') defs = Object.values(FILTER_DEFINITIONS).flat();
    else defs = FILTER_DEFINITIONS[tabId] || [];

    if (filterSearch.trim()) {
      const q = filterSearch.toLowerCase();
      defs = defs.filter(def => def.label.toLowerCase().includes(q));
    }
    return defs;
  }

  function handleInputChange(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  function toggleCatalyst(value) {
    setFilters(prev => {
      const set = new Set(prev.catalysts || []);
      set.has(value) ? set.delete(value) : set.add(value);
      return { ...prev, catalysts: Array.from(set) };
    });
  }

  function resetFilters() {
    const defaults = buildFilterDefaults();
    setFilters(defaults);
    setFilterSearch('');
    onClear?.();
  }

  function handleSavePreset() {
    if (!presetName.trim()) return;
    const preset = { name: presetName.trim(), filters: { ...filters }, savedAt: new Date().toISOString() };
    const updated = [...presets.filter(p => p.name !== preset.name), preset];
    setPresets(updated);
    savePresets(updated);
    setPresetName('');
    setShowPresetMenu(false);
  }

  function handleLoadPreset(preset) {
    setFilters(prev => ({ ...prev, ...preset.filters }));
    setShowPresetMenu(false);
  }

  function handleDeletePreset(name) {
    const updated = presets.filter(p => p.name !== name);
    setPresets(updated);
    savePresets(updated);
  }

  function handleLoadStrategyPreset(preset) {
    const defaults = buildFilterDefaults();
    setFilters({ ...defaults, ...preset.filters });
    setShowStrategyPresets(false);
  }

  function renderFilterField(def) {
    if (def.type === 'pills') return null;

    if (def.type === 'multiselect') {
      return (
        <MultiSelectDropdown
          key={def.key}
          def={def}
          values={filters[def.key]}
          onChange={(vals) => handleInputChange(def.key, vals)}
        />
      );
    }

    if (def.type === 'select') {
      return (
        <div key={def.key} className="form-field">
          <label>{def.label}</label>
          <select
            value={filters[def.key] || ''}
            onChange={e => handleInputChange(def.key, e.target.value)}
          >
            {(def.options || []).map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div key={def.key} className="form-field">
        <label>{def.label}</label>
        <input
          type="text"
          placeholder={def.placeholder || ''}
          value={filters[def.key] || ''}
          onChange={e => handleInputChange(def.key, e.target.value)}
        />
      </div>
    );
  }

  const showCatalysts = activeTab === 'news' || activeTab === 'all';

  if (collapsed && setCollapsed) {
    return (
      <div className="filter-panel-collapsed" onClick={() => setCollapsed(false)}>
        <span>Filters {activeCount > 0 && <span className="filter-count-badge">{activeCount}</span>}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Click to expand</span>
      </div>
    );
  }

  return (
    <div className="panel filter-panel" style={{ marginBottom: 16 }}>
      <div className="filter-tabs">
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            className={`filter-tab ${activeTab === tab.id ? 'filter-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {/* Strategy Presets */}
          <div ref={strategyRef} style={{ position: 'relative' }}>
            <button className="btn-secondary btn-sm" onClick={() => setShowStrategyPresets(o => !o)}>
              <Zap size={14} /> Strategies
            </button>
            {showStrategyPresets && (
              <div className="preset-menu">
                <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Strategy Presets
                </div>
                <div className="preset-menu__list">
                  {STRATEGY_PRESETS.map(p => (
                    <div key={p.name} className="preset-menu__item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                      <button className="preset-menu__load" onClick={() => handleLoadStrategyPreset(p)}>
                        {p.name}
                      </button>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 8, paddingBottom: 4 }}>{p.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Custom Presets */}
          <div ref={presetRef} style={{ position: 'relative' }}>
            <button className="btn-secondary btn-sm" onClick={() => setShowPresetMenu(o => !o)}>
              <FolderOpen size={14} /> Presets
            </button>
            {showPresetMenu && (
              <div className="preset-menu">
                <div className="preset-menu__save">
                  <input type="text" placeholder="Preset name..." value={presetName}
                    onChange={e => setPresetName(e.target.value)} className="preset-menu__input"
                    onKeyDown={e => e.key === 'Enter' && handleSavePreset()} />
                  <button className="btn-primary btn-sm" onClick={handleSavePreset} disabled={!presetName.trim()}>
                    <Save size={12} /> Save
                  </button>
                </div>
                {presets.length > 0 && (
                  <div className="preset-menu__list">
                    {presets.map(p => (
                      <div key={p.name} className="preset-menu__item">
                        <button className="preset-menu__load" onClick={() => handleLoadPreset(p)}>{p.name}</button>
                        <button className="preset-menu__delete" onClick={() => handleDeletePreset(p.name)}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
                {presets.length === 0 && (
                  <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)' }}>No saved presets</div>
                )}
              </div>
            )}
          </div>
          {setCollapsed && (
            <button className="btn-secondary btn-sm" onClick={() => setCollapsed(true)}>Collapse</button>
          )}
        </div>
      </div>

      {/* Filter search bar */}
      <div className="filter-search-bar">
        <Search size={14} />
        <input
          type="text"
          placeholder="Search filters..."
          value={filterSearch}
          onChange={e => setFilterSearch(e.target.value)}
        />
        {filterSearch && (
          <button type="button" className="filter-search-bar__clear" onClick={() => setFilterSearch('')}><X size={12} /></button>
        )}
      </div>

      <div
        className="filter-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        {getVisibleFilters(activeTab).map(def => renderFilterField(def))}
      </div>

      {filterSearch && getVisibleFilters(activeTab).length === 0 && (
        <div style={{ padding: '12px 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          No filters match "{filterSearch}"
        </div>
      )}

      {showCatalysts && filters.catalysts !== undefined && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Catalysts</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATALYST_OPTIONS.map(opt => {
              const active = (filters.catalysts || []).includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  className={`pill-btn ${active ? 'pill-btn--active' : ''}`}
                  onClick={() => toggleCatalyst(opt)}
                >
                  <FilterIcon size={14} /> {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Action buttons inside filter panel */}
      {showActionButtons && (
        <div className="filter-panel__actions">
          {onTogglePanel && (
            <button className="btn-secondary btn-sm" onClick={onTogglePanel}>Hide Filters</button>
          )}
          <button className="btn-primary btn-sm" onClick={() => onApply?.()}>Apply Filters</button>
          <button className="btn-secondary btn-sm" onClick={resetFilters}>
            <X size={14} /> Clear Filters
          </button>
        </div>
      )}

      {extraControls}
    </div>
  );
}
