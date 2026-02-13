import React from 'react';

const FILTER_FIELDS = [
  { key: 'priceMin', label: 'Price Min', placeholder: '5', type: 'number', step: '1' },
  { key: 'priceMax', label: 'Price Max', placeholder: '500', type: 'number', step: '1' },
  { key: 'gapMin', label: 'Gap% Min', placeholder: '2', type: 'number', step: '0.5' },
  { key: 'rvolMin', label: 'RVOL Min', placeholder: '1.5', type: 'number', step: '0.1' },
  { key: 'avgVolMin', label: 'Avg Vol Min', placeholder: '500000', type: 'number', step: '100000' },
  { key: 'emMin', label: 'Exp Move% Min', placeholder: '3', type: 'number', step: '1' },
  { key: 'minConfirmations', label: 'Min Confirmations', placeholder: '1', type: 'number', step: '1' },
];

export default function GlobalFiltersPanel({ filters, setFilters, validationMode, setValidationMode, collapsed, setCollapsed }) {
  const update = (key, val) => {
    const v = val === '' ? undefined : Number(val);
    setFilters(prev => ({ ...prev, [key]: v }));
  };

  const activeCount = Object.values(filters).filter(v => v != null).length + (validationMode ? 1 : 0);
  const clearAll = () => { setFilters({}); setValidationMode(false); };

  return (
    <div className="aiq-filters-panel">
      <div className="aiq-filters-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="aiq-filters-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
          Filters {activeCount > 0 && <span className="aiq-filters-count">{activeCount}</span>}
        </span>
        <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {activeCount > 0 && <button className="aiq-filters-clear" onClick={e => { e.stopPropagation(); clearAll(); }}>Clear</button>}
          <span className="aiq-filters-chevron">{collapsed ? '▸' : '▾'}</span>
        </span>
      </div>
      {!collapsed && (
        <div className="aiq-filters-body">
          <div className="aiq-filters-grid">
            {FILTER_FIELDS.map(f => (
              <label key={f.key} className="aiq-filter-field">
                <span>{f.label}</span>
                <input type={f.type} step={f.step} placeholder={f.placeholder}
                  value={filters[f.key] ?? ''} onChange={e => update(f.key, e.target.value)} />
              </label>
            ))}
          </div>
          <label className="aiq-validation-toggle">
            <input type="checkbox" checked={validationMode} onChange={e => setValidationMode(e.target.checked)} />
            <span className="aiq-validation-label">
              <strong>Validation Mode</strong>
              <small>≥2 confirmations · Avg Vol ≥500K · Complete data only</small>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
