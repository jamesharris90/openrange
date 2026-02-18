import { SlidersHorizontal, X } from 'lucide-react';
import TabbedFilterPanel from '../shared/TabbedFilterPanel';

const STRATEGY_UNIVERSE = {
  orb: { label: 'ORB Intraday', rules: 'Avg Volume > 500K · Change > 3%' },
  earnings: { label: 'Earnings Momentum', rules: 'Earnings Calendar · Next 5 Days' },
  continuation: { label: 'Continuation', rules: 'Above 20-SMA · Above 50-SMA · Avg Vol > 500K' },
};

export default function GlobalFiltersPanel({
  filters, setFilters, validationMode, setValidationMode,
  collapsed, setCollapsed, activeStrategy,
}) {
  const activeCount = Object.entries(filters).filter(([, v]) => {
    if (Array.isArray(v)) return v.length > 0;
    return v !== '' && v != null;
  }).length + (validationMode ? 1 : 0);

  const universe = STRATEGY_UNIVERSE[activeStrategy];

  if (collapsed) {
    return (
      <button className="aiq-filter-toggle-btn" onClick={() => setCollapsed(false)} type="button">
        <SlidersHorizontal size={14} />
        <span>Filters</span>
        {activeCount > 0 && <span className="filter-count-badge">{activeCount}</span>}
      </button>
    );
  }

  return (
    <div className="aiq-filters-panel">
      <div className="aiq-filters-panel__header">
        <div className="aiq-filters-panel__title">
          <SlidersHorizontal size={14} />
          <span>Filters</span>
          {activeCount > 0 && <span className="filter-count-badge">{activeCount}</span>}
        </div>
        <button className="aiq-icon-btn" onClick={() => setCollapsed(true)} title="Collapse"><X size={14} /></button>
      </div>

      {/* Strategy Universe Rules */}
      {universe && (
        <div className="aiq-filters-universe">
          <span className="aiq-filters-universe__label">Strategy Universe:</span>
          <span className="aiq-filters-universe__rules">{universe.rules}</span>
        </div>
      )}

      {/* Full TabbedFilterPanel with all filters */}
      <TabbedFilterPanel
        filters={filters}
        setFilters={setFilters}
        collapsed={false}
        setCollapsed={null}
      />

      {/* Validation Mode */}
      <label className="aiq-validation-toggle">
        <input type="checkbox" checked={validationMode} onChange={e => setValidationMode(e.target.checked)} />
        <span className="aiq-validation-label">
          <strong>Validation Mode</strong>
          <small>2+ confirmations · Avg Vol 500K+ · Complete data only</small>
        </span>
      </label>
    </div>
  );
}
