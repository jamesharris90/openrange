import { useState } from 'react';
import { Zap, TrendingUp, BarChart3, Download, ListPlus } from 'lucide-react';
import ORBModule from './ORBModule';
import EarningsModule from './EarningsModule';
import ContinuationModule from './ContinuationModule';
import { exportToCSV } from './scoring';

const TABS = [
  { id: 'orb', label: 'ORB Intraday', icon: Zap, desc: 'Opening Range Breakout — gap + volume momentum' },
  { id: 'earnings', label: 'Earnings Momentum', icon: BarChart3, desc: 'Post-earnings moves — expected move + surprise' },
  { id: 'continuation', label: 'Continuation', icon: TrendingUp, desc: 'Multi-day trend — MA alignment + breakout' },
];

export default function StrategyPanel({ activeStrategy, onChangeStrategy, onSelectTicker,
  filters, selected, onToggleSelect, onDataReady, allData, addToast, watchlist }) {

  const [exportOpen, setExportOpen] = useState(false);

  const currentRows = allData?.[activeStrategy] || [];

  const handleExport = (mode) => {
    let rows;
    if (mode === 'selected') rows = currentRows.filter(r => selected.has(r.ticker));
    else if (mode === 'top10') rows = [...currentRows].sort((a, b) => b.score - a.score).slice(0, 10);
    else rows = currentRows;
    if (!rows.length) { addToast?.('No rows to export', 'info'); return; }
    exportToCSV(rows, `aiq-${activeStrategy}-${mode}.csv`, activeStrategy);
    addToast?.(`Exported ${rows.length} rows`, 'success');
    setExportOpen(false);
  };

  const handleBulkWL = () => {
    if (!selected.size) { addToast?.('Select rows first', 'info'); return; }
    let added = 0;
    for (const t of selected) {
      if (!watchlist?.has(t)) { watchlist?.add(t, `aiq-${activeStrategy}`); added++; }
    }
    addToast?.(`Added ${added} ticker${added !== 1 ? 's' : ''} to watchlist`, 'success');
  };

  return (
    <div className="aiq-panel aiq-strategy">
      <div className="aiq-tabs">
        {TABS.map(t => {
          const Icon = t.icon;
          const count = (allData?.[t.id] || []).length;
          return (
            <button key={t.id}
              className={`aiq-tab ${activeStrategy === t.id ? 'aiq-tab--active' : ''}`}
              onClick={() => onChangeStrategy(t.id)} title={t.desc}>
              <Icon size={15} />
              <span>{t.label}</span>
              {count > 0 && <span className="aiq-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Toolbar: description + export + bulk watchlist */}
      <div className="aiq-toolbar">
        <div className="aiq-tab-desc">{TABS.find(t => t.id === activeStrategy)?.desc}</div>
        <div className="aiq-toolbar-actions">
          <div style={{ position: 'relative' }}>
            <button className="aiq-btn aiq-btn--sm" onClick={() => setExportOpen(!exportOpen)}>
              <Download size={13} /> CSV
            </button>
            {exportOpen && (
              <div className="aiq-export-menu">
                <button onClick={() => handleExport('all')}>Export All</button>
                <button onClick={() => handleExport('top10')}>Export Top 10</button>
                <button onClick={() => handleExport('selected')}>Export Selected</button>
              </div>
            )}
          </div>
          <button className="aiq-btn aiq-btn--sm" onClick={handleBulkWL} disabled={!selected.size}>
            <ListPlus size={13} /> Add to WL ({selected.size})
          </button>
        </div>
      </div>

      <div className="aiq-module-container">
        {activeStrategy === 'orb' && <ORBModule onSelectTicker={onSelectTicker}
          filters={filters} selected={selected} onToggleSelect={onToggleSelect}
          onDataReady={onDataReady} watchlist={watchlist} />}
        {activeStrategy === 'earnings' && <EarningsModule onSelectTicker={onSelectTicker}
          filters={filters} selected={selected} onToggleSelect={onToggleSelect}
          onDataReady={onDataReady} watchlist={watchlist} />}
        {activeStrategy === 'continuation' && <ContinuationModule onSelectTicker={onSelectTicker}
          filters={filters} selected={selected} onToggleSelect={onToggleSelect}
          onDataReady={onDataReady} watchlist={watchlist} />}
      </div>
    </div>
  );
}
