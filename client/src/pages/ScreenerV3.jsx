// ScreenerV3 — OpenRange Screener Engine v1
// Finviz-style add-filter panel · 12-structure classification · SPY-adaptive
// All colors use CSS custom properties (dark/light theme compatible).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../utils/api';

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY  = 'screener-v3-v2'; // bumped to clear old state
const DEFAULT_PAGE_SIZE = 25;
const AUTO_REFRESH = 30_000;
const FILTER_PANEL_MIN_WIDTH = 240;
const FILTER_PANEL_MAX_WIDTH = 640;

const STRUCTURE_DEFS = [
  { name: 'ORB',                 label: 'ORB',           side: 'bullish' },
  { name: 'GapAndGo',            label: 'Gap & Go',      side: 'bullish' },
  { name: 'TrendDay',            label: 'Trend Day',     side: 'bullish' },
  { name: 'VWAPReclaim',         label: 'VWAP Reclaim',  side: 'bullish' },
  { name: 'MicroPullback',       label: 'Micro PB',      side: 'bullish' },
  { name: 'LiquiditySweep',      label: 'Liq. Sweep',    side: 'bullish' },
  { name: 'CompressionBreakout', label: 'Compr. BO',     side: 'bullish' },
  { name: 'Breakdown',           label: 'Breakdown',     side: 'bearish' },
  { name: 'MeanReversion',       label: 'Mean Rev.',     side: 'bullish' },
  { name: 'Squeeze',             label: 'Squeeze',       side: 'neutral' },
  { name: 'Drift',               label: 'Drift',         side: 'neutral' },
  { name: 'ReversalBase',        label: 'Rev. Base',     side: 'bullish' },
];

const GRADE_ORDER = ['A+', 'A', 'B', 'C'];

const SECTIONS = ['All', 'Descriptive', 'Performance', 'Technical', 'Structure'];

// Filter definitions — each id matches keys used in the query string
const FILTER_DEFS = [
  // ── Descriptive
  { id: 'price',         label: 'Price',           section: 'Descriptive', type: 'range',
    minKey: 'minPrice',          maxKey: 'maxPrice',          prefix: '$' },
  { id: 'marketCap',     label: 'Market Cap',      section: 'Descriptive', type: 'range',
    minKey: 'minMarketCap',      maxKey: 'maxMarketCap',      unit: '$M',  scale: 1e6 },
  { id: 'float',         label: 'Float Shares',    section: 'Descriptive', type: 'range',
    minKey: 'minFloat',          maxKey: 'maxFloat',          unit: 'M',   scale: 1e6 },
  { id: 'exchange',      label: 'Exchange',        section: 'Descriptive', type: 'select',
    key: 'exchange',  options: ['NASDAQ', 'NYSE', 'AMEX', 'OTC'] },
  // ── Performance
  { id: 'changePercent', label: 'Change %',        section: 'Performance', type: 'range',
    minKey: 'minChangePercent',  maxKey: 'maxChangePercent',  unit: '%' },
  { id: 'gapPercent',    label: 'Gap %',           section: 'Performance', type: 'range',
    minKey: 'minGapPercent',     maxKey: 'maxGapPercent',     unit: '%' },
  { id: 'volume',        label: 'Volume',          section: 'Performance', type: 'range',
    minKey: 'minVolume',         maxKey: 'maxVolume' },
  { id: 'dollarVolume',  label: 'Dollar Volume',   section: 'Performance', type: 'range',
    minKey: 'minDollarVolume',   maxKey: 'maxDollarVolume',   unit: '$M',  scale: 1e6 },
  // ── Technical
  { id: 'relVol',        label: 'Relative Volume', section: 'Technical',   type: 'range',
    minKey: 'minRelativeVolume', maxKey: 'maxRelativeVolume', unit: 'x' },
  { id: 'rsi14',         label: 'RSI 14',          section: 'Technical',   type: 'range',
    minKey: 'minRsi14',          maxKey: 'maxRsi14' },
  { id: 'atrPercent',    label: 'ATR %',           section: 'Technical',   type: 'range',
    minKey: 'minAtrPercent',     maxKey: 'maxAtrPercent',     unit: '%' },
  // ── Structure
  { id: 'structures',    label: 'Structure Type',  section: 'Structure',   type: 'multiselect',
    key: 'structures' },
  { id: 'minGrade',      label: 'Min Grade',       section: 'Structure',   type: 'grade',
    key: 'minGrade' },
  { id: 'adaptSpy',      label: 'Adapt to SPY',    section: 'Structure',   type: 'toggle',
    key: 'adaptFilters' },
];

const FILTER_MAP = Object.fromEntries(FILTER_DEFS.map(f => [f.id, f]));

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtLarge(n) {
  if (!Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9)  return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3)  return `${(n / 1e3).toFixed(0)}K`;
  return n.toFixed(0);
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return '–';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtPrice(n) {
  if (!Number.isFinite(n)) return '–';
  return `$${n.toFixed(2)}`;
}

function fmtRvol(n) {
  if (!Number.isFinite(n)) return '–';
  return `${n.toFixed(2)}x`;
}

function fmtNum(n, d = 2) {
  if (!Number.isFinite(n)) return '–';
  return n.toFixed(d);
}

function toFiniteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toCsvCell(value) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function exportRowsToCsv(rows, filename) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return;

  const keySet = new Set();
  list.forEach((row) => {
    Object.keys(row || {}).forEach((key) => keySet.add(key));
  });

  const preferredOrder = [
    'symbol',
    'exchange',
    'price',
    'change',
    'changePercent',
    'volume',
    'marketCap',
    'floatShares',
    'avgVolume30d',
    'relativeVolume',
    'rvolConfidence',
    'gapPercent',
    'dollarVolume',
    'structure',
    'structureLabel',
    'structureSide',
    'structureGrade',
    'structureScore',
    'structureExplanation',
    'sector',
    'industry',
  ];

  const remaining = Array.from(keySet)
    .filter((key) => !preferredOrder.includes(key))
    .sort((a, b) => a.localeCompare(b));

  const orderedKeys = [...preferredOrder.filter((key) => keySet.has(key)), ...remaining];

  const lines = [
    orderedKeys.join(','),
    ...list.map((row) => orderedKeys.map((key) => toCsvCell(row?.[key])).join(',')),
  ];

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ─── Color helpers ──────────────────────────────────────────────────────────

function pctColor(n) {
  if (!Number.isFinite(n)) return 'var(--text-muted)';
  return n >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
}

function biasColor(bias) {
  if (bias >= 3)  return 'var(--accent-green)';
  if (bias <= -3) return 'var(--accent-red)';
  return '#f59e0b';
}

function sideColor(side) {
  if (side === 'bearish') return 'var(--accent-red)';
  if (side === 'neutral') return 'var(--accent-blue)';
  return 'var(--accent-green)';
}

function gradeColor(g) {
  if (g === 'A+') return '#f59e0b';
  if (g === 'A')  return 'var(--accent-green)';
  if (g === 'B')  return 'var(--text-secondary)';
  return 'var(--text-muted)';
}

// ─── Filter state helpers ────────────────────────────────────────────────────

function buildQuery(activeIds, values) {
  const q = {};
  activeIds.forEach(id => {
    const def = FILTER_MAP[id];
    if (!def) return;
    const scale = def.scale || 1;
    if (def.type === 'range') {
      const mn = values[def.minKey];
      const mx = values[def.maxKey];
      if (mn !== '' && mn != null) q[def.minKey] = parseFloat(mn) * scale;
      if (mx !== '' && mx != null) q[def.maxKey] = parseFloat(mx) * scale;
    } else if (def.type === 'select') {
      if (values[def.key]) q[def.key] = values[def.key];
    } else if (def.type === 'multiselect') {
      const v = values[def.key];
      if (v && v.length) q[def.key] = v.join(',');
    } else if (def.type === 'grade') {
      if (values[def.key]) q[def.key] = values[def.key];
    } else if (def.type === 'toggle') {
      if (values[def.key]) q[def.key] = 'true';
    }
  });
  return q;
}

function clearFilterValues(id, values) {
  const def = FILTER_MAP[id];
  if (!def) return values;
  const next = { ...values };
  if (def.type === 'range') {
    delete next[def.minKey];
    delete next[def.maxKey];
  } else {
    delete next[def.key];
  }
  return next;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

// ─── Shared style tokens ─────────────────────────────────────────────────────

const inputSt = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-primary)',
  borderRadius: 4,
  padding: '3px 6px',
  fontSize: 11,
  outline: 'none',
  width: 70,
};

const btnSt = {
  padding: '3px 8px',
  borderRadius: 4,
  fontSize: 11,
  cursor: 'pointer',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)',
};

// ─── SPY State pill ───────────────────────────────────────────────────────────

function SpyPill({ env }) {
  if (!env) return (
    <div style={{ padding: '5px 16px', background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-color)', fontSize: 12, color: 'var(--text-muted)' }}>
      SPY State: loading…
    </div>
  );

  const { spyChangePercent, spyPrice, vixLevel, vixDecile, bias, session } = env;
  const bc = biasColor(bias ?? 0);
  const sep = <span style={{ color: 'var(--border-color)' }}>│</span>;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '5px 16px',
      background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)',
      fontSize: 12, flexWrap: 'wrap', flexShrink: 0 }}>
      <span style={{ fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.06em' }}>SPY</span>
      {spyPrice   != null && <span style={{ color: 'var(--text-primary)' }}>{fmtPrice(spyPrice)}</span>}
      {spyChangePercent != null && (
        <span style={{ color: pctColor(spyChangePercent), fontWeight: 600 }}>{fmtPct(spyChangePercent)}</span>
      )}
      {sep}
      <span style={{ color: 'var(--text-secondary)' }}>
        VIX {vixLevel != null ? vixLevel.toFixed(1) : '–'}
        {vixDecile != null && <span style={{ color: 'var(--text-muted)', marginLeft: 3 }}>D{vixDecile}</span>}
      </span>
      {sep}
      <span style={{ color: bc, fontWeight: 700 }}>
        Bias {bias != null ? (bias > 0 ? `+${bias}` : `${bias}`) : '0'}
      </span>
      {sep}
      <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>
        {(session || 'overnight').replace(/-/g, ' ')}
      </span>
    </div>
  );
}

// ─── Individual filter row ────────────────────────────────────────────────────

function FilterRow({ id, filterValues, onChange, onRemove }) {
  const def = FILTER_MAP[id];
  if (!def) return null;

  const set = (key, val) => onChange({ ...filterValues, [key]: val });

  let controls = null;

  if (def.type === 'range') {
    const mn = filterValues[def.minKey] ?? '';
    const mx = filterValues[def.maxKey] ?? '';
    controls = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
        <input type="number" value={mn} placeholder={`Min${def.prefix ? ' ' + def.prefix : ''}`}
          style={inputSt} onChange={e => set(def.minKey, e.target.value)} />
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>–</span>
        <input type="number" value={mx} placeholder={`Max${def.prefix ? ' ' + def.prefix : ''}`}
          style={inputSt} onChange={e => set(def.maxKey, e.target.value)} />
        {def.unit && <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{def.unit}</span>}
      </div>
    );

  } else if (def.type === 'select') {
    const val = filterValues[def.key] || '';
    controls = (
      <select value={val} onChange={e => set(def.key, e.target.value)}
        style={{ ...inputSt, width: 'auto', minWidth: 90, padding: '3px 6px' }}>
        <option value="">Any</option>
        {def.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );

  } else if (def.type === 'multiselect') {
    const selected = filterValues[def.key] || [];
    const remaining = STRUCTURE_DEFS.filter(s => !selected.includes(s.name));
    controls = (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, flex: 1 }}>
        {selected.map(name => {
          const s = STRUCTURE_DEFS.find(d => d.name === name);
          const c = s ? sideColor(s.side) : 'var(--accent-blue)';
          return (
            <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 3,
              background: `${c}22`, border: `1px solid ${c}66`, color: c,
              borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
              {s?.label || name}
              <button onClick={() => set(def.key, selected.filter(n => n !== name))}
                style={{ background: 'none', border: 'none', color: c, cursor: 'pointer',
                  padding: 0, lineHeight: 1, fontSize: 12 }}>×</button>
            </span>
          );
        })}
        {remaining.length > 0 && (
          <select value="" onChange={e => { if (e.target.value) set(def.key, [...selected, e.target.value]); }}
            style={{ ...inputSt, width: 'auto', minWidth: 70, fontSize: 10, padding: '1px 4px' }}>
            <option value="">+ Add…</option>
            {remaining.map(s => <option key={s.name} value={s.name}>{s.label}</option>)}
          </select>
        )}
      </div>
    );

  } else if (def.type === 'grade') {
    const val = filterValues[def.key] || '';
    controls = (
      <div style={{ display: 'flex', gap: 3 }}>
        {GRADE_ORDER.map(g => (
          <button key={g} onClick={() => set(def.key, val === g ? '' : g)}
            style={{ padding: '2px 7px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 800,
              border: `1px solid ${val === g ? gradeColor(g) : 'var(--border-color)'}`,
              background: val === g ? `${gradeColor(g)}33` : 'transparent',
              color: val === g ? gradeColor(g) : 'var(--text-muted)' }}>
            {g}
          </button>
        ))}
      </div>
    );

  } else if (def.type === 'toggle') {
    const val = !!filterValues[def.key];
    controls = (
      <button onClick={() => set(def.key, !val)}
        style={{ padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer',
          border: 'none', background: val ? 'var(--accent-green)' : 'var(--bg-elevated)',
          color: val ? '#0f172a' : 'var(--text-muted)' }}>
        {val ? 'ON' : 'OFF'}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px',
      borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', minWidth: 88,
        paddingTop: 2, whiteSpace: 'nowrap' }}>{def.label}</span>
      <div style={{ flex: 1 }}>{controls}</div>
      <button onClick={onRemove}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
          fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0, paddingTop: 1 }}>
        ×
      </button>
    </div>
  );
}

// ─── Filter Panel (Finviz-style) ─────────────────────────────────────────────

function FilterPanel({
  activeFilterIds, filterValues,
  onFilterIdsChange, onFilterValuesChange,
  onApplyFilters,
  onClearFilters,
  adjustments, totalCount,
  savedPresets, onSavePreset, onLoadPreset, onDeletePreset,
  width,
  onResizeStart,
}) {
  const [activeSection, setActiveSection] = useState('All');
  const [search, setSearch]               = useState('');
  const [showPresets, setShowPresets]     = useState(false);
  const [showSaveRow, setShowSaveRow]     = useState(false);
  const [presetName, setPresetName]       = useState('');
  const presetsRef = useRef(null);

  // Close preset dropdown on outside click
  useEffect(() => {
    function handle(e) {
      if (presetsRef.current && !presetsRef.current.contains(e.target)) setShowPresets(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Count active filters per section (excluding 'All')
  const sectionCounts = useMemo(() => {
    const c = {};
    SECTIONS.slice(1).forEach(sec => {
      c[sec] = FILTER_DEFS.filter(f => f.section === sec && activeFilterIds.includes(f.id)).length;
    });
    return c;
  }, [activeFilterIds]);

  // Available filters (not added, matching section + search)
  const available = useMemo(() => FILTER_DEFS.filter(f => {
    const inSec   = activeSection === 'All' || f.section === activeSection;
    const notAdded = !activeFilterIds.includes(f.id);
    const matches  = !search || f.label.toLowerCase().includes(search.toLowerCase());
    return inSec && notAdded && matches;
  }), [activeSection, activeFilterIds, search]);

  const addFilter   = id  => !activeFilterIds.includes(id) && onFilterIdsChange([...activeFilterIds, id]);
  const removeFilter = id => {
    onFilterIdsChange(activeFilterIds.filter(fid => fid !== id));
    onFilterValuesChange(clearFilterValues(id, filterValues));
  };
  const clearAll = () => {
    if (typeof onClearFilters === 'function') {
      onClearFilters();
      return;
    }
    onFilterIdsChange([]);
    onFilterValuesChange({});
  };

  const doSave = () => {
    if (!presetName.trim()) return;
    onSavePreset(presetName.trim(), activeFilterIds, filterValues);
    setPresetName(''); setShowSaveRow(false);
  };

  const tabStyle = (sec) => ({
    padding: '3px 9px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600,
    background: activeSection === sec ? 'var(--accent-blue)' : 'transparent',
    color: activeSection === sec ? '#fff' : 'var(--text-muted)',
    border: 'none', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ width, minWidth: FILTER_PANEL_MIN_WIDTH, flexShrink: 0, background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column',
      overflowY: 'auto', position: 'relative' }}>

      <div
        onMouseDown={onResizeStart}
        style={{
          position: 'absolute',
          top: 0,
          right: -3,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 10,
        }}
      />

      {/* ── Sticky header: section tabs + search */}
      <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-surface)',
        padding: '10px 10px 0', borderBottom: '1px solid var(--border-color)' }}>

        {/* Section tabs */}
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginBottom: 7 }}>
          {SECTIONS.map(sec => (
            <button key={sec} onClick={() => setActiveSection(sec)} style={tabStyle(sec)}>
              {sec}
              {sec !== 'All' && sectionCounts[sec] > 0 && (
                <span style={{ marginLeft: 3, background: '#fff', color: 'var(--accent-blue)',
                  borderRadius: 8, padding: '0 4px', fontSize: 9, fontWeight: 800 }}>
                  {sectionCounts[sec]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <input type="text" placeholder="Search filters…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: '5px 8px', borderRadius: 5, fontSize: 11,
            background: 'var(--bg-input)', border: '1px solid var(--border-color)',
            color: 'var(--text-primary)', outline: 'none', marginBottom: 8,
            boxSizing: 'border-box' }} />
      </div>

      {/* ── Available filters to add */}
      {available.length > 0 && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700,
            letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>
            Add filter
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {available.map(def => (
              <button key={def.id} onClick={() => addFilter(def.id)}
                style={{ padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                  background: 'transparent', border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ color: 'var(--accent-blue)', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>+</span>
                {def.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Active filter rows */}
      <div style={{ flex: 1, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {activeFilterIds.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>
            No filters applied.
            <br /><span style={{ fontSize: 11 }}>Click + above to add one.</span>
          </div>
        )}
        {activeFilterIds.map(id => (
          <FilterRow key={id} id={id} filterValues={filterValues}
            onChange={onFilterValuesChange} onRemove={() => removeFilter(id)} />
        ))}
      </div>

      {/* ── SPY adjustments notice */}
      {adjustments && adjustments.length > 0 && (
        <div style={{ margin: '0 10px 8px', padding: '8px 10px', borderRadius: 6, fontSize: 11,
          background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)' }}>
          <div style={{ color: 'var(--accent-blue)', fontWeight: 700, marginBottom: 4 }}>SPY Adjustments</div>
          {adjustments.map((adj, i) => (
            <div key={i} style={{ color: 'var(--text-secondary)', marginTop: 2, fontSize: 10 }}>
              <span style={{ color: 'var(--text-primary)' }}>{adj.field}</span>:
              {' '}{typeof adj.original === 'number' ? adj.original.toFixed(2) : adj.original}
              {' →'}<span style={{ color: 'var(--accent-green)' }}>{typeof adj.adjusted === 'number' ? adj.adjusted.toFixed(2) : adj.adjusted}</span>
              <span style={{ color: 'var(--text-muted)' }}> ({adj.reason})</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Sticky footer: presets + clear */}
      <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-color)', padding: '10px' }}>

        {/* Result count */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {totalCount != null ? `${totalCount.toLocaleString()} results` : '—'}
          </span>
        </div>

        {/* Saved Presets dropdown + Save button */}
        <div style={{ display: 'flex', gap: 5 }} ref={presetsRef}>
          <div style={{ position: 'relative', flex: 1 }}>
            <button onClick={() => { setShowPresets(p => !p); setShowSaveRow(false); }}
              style={{ width: '100%', padding: '5px 8px', borderRadius: 5, fontSize: 11,
                cursor: 'pointer', background: 'var(--bg-elevated)',
                border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Saved Presets</span>
              <span style={{ fontSize: 10 }}>▾</span>
            </button>
            {showPresets && (
              <div style={{ position: 'absolute', bottom: '110%', left: 0, right: 0, zIndex: 100,
                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                borderRadius: 6, boxShadow: 'var(--shadow-md)', maxHeight: 180, overflowY: 'auto' }}>
                {savedPresets.length === 0 && (
                  <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)' }}>No presets yet</div>
                )}
                {savedPresets.map((p, i) => (
                  <div key={i} onClick={() => { onLoadPreset(p); setShowPresets(false); }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 10px', borderBottom: '1px solid var(--border-color)',
                      cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <span style={{ fontSize: 11, color: 'var(--text-primary)' }}>{p.name}</span>
                    <button onClick={e => { e.stopPropagation(); onDeletePreset(i); }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)',
                        cursor: 'pointer', fontSize: 14, padding: 0 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => { setShowSaveRow(p => !p); setShowPresets(false); }}
            style={{ padding: '5px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', background: 'var(--accent-blue)', border: 'none', color: '#fff' }}>
            Save
          </button>
        </div>

        {/* Inline save name input */}
        {showSaveRow && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <input type="text" placeholder="Preset name…" value={presetName}
              onChange={e => setPresetName(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') setShowSaveRow(false); }}
              style={{ flex: 1, padding: '4px 7px', borderRadius: 4, fontSize: 11,
                background: 'var(--bg-input)', border: '1px solid var(--border-color)',
                color: 'var(--text-primary)', outline: 'none' }} />
            <button onClick={doSave}
              style={{ padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700,
                cursor: 'pointer', background: 'var(--accent-green)', border: 'none', color: '#fff' }}>
              ✓
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            onClick={() => onApplyFilters && onApplyFilters()}
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              background: 'var(--accent-blue)',
              border: 'none',
              color: '#fff',
            }}
          >
            Apply Filters
          </button>
          <button
            onClick={clearAll}
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              background: 'var(--accent-red)',
              border: 'none',
              color: '#fff',
            }}
          >
            Clear Filters
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Results table ────────────────────────────────────────────────────────────

const COLUMN_REGISTRY = [
  { key: 'symbol', label: 'Symbol', category: 'Identity', format: 'text', w: 92 },
  { key: 'name', label: 'Name', category: 'Identity', format: 'text', w: 180 },
  { key: 'exchange', label: 'Exchange', category: 'Identity', format: 'text', w: 86 },
  { key: 'sector', label: 'Sector', category: 'Identity', format: 'text', w: 120 },
  { key: 'industry', label: 'Industry', category: 'Identity', format: 'text', w: 150 },

  { key: 'price', label: 'Price', category: 'Price/Perf', format: 'price', w: 86 },
  { key: 'changePercent', label: 'Chg %', category: 'Price/Perf', format: 'percent', w: 78 },
  { key: 'gapPercent', label: 'Gap %', category: 'Price/Perf', format: 'percent', w: 76 },
  { key: 'volume', label: 'Volume', category: 'Volume', format: 'large', w: 90 },
  { key: 'avgVolume', label: 'Avg Vol', category: 'Volume', format: 'large', w: 92 },
  { key: 'relativeVolume', label: 'RVOL', category: 'Volume', format: 'rvol', w: 72 },
  { key: 'dollarVolume', label: '$ Volume', category: 'Volume', format: 'large', w: 96 },

  { key: 'marketCap', label: 'Mkt Cap', category: 'Valuation', format: 'large', w: 96 },
  { key: 'pe', label: 'P/E', category: 'Valuation', format: 'num2', w: 70 },
  { key: 'forwardPe', label: 'Fwd P/E', category: 'Valuation', format: 'num2', w: 84 },
  { key: 'peg', label: 'PEG', category: 'Valuation', format: 'num2', w: 70 },
  { key: 'ps', label: 'P/S', category: 'Valuation', format: 'num2', w: 70 },
  { key: 'pb', label: 'P/B', category: 'Valuation', format: 'num2', w: 70 },

  { key: 'rsi14', label: 'RSI 14', category: 'Technical', format: 'num1', w: 72 },
  { key: 'atrPercent', label: 'ATR %', category: 'Technical', format: 'percent1', w: 70 },
  { key: 'sma20', label: 'SMA 20', category: 'Technical', format: 'price', w: 86 },
  { key: 'sma50', label: 'SMA 50', category: 'Technical', format: 'price', w: 86 },
  { key: 'sma200', label: 'SMA 200', category: 'Technical', format: 'price', w: 92 },

  { key: 'roe', label: 'ROE', category: 'Financial Health', format: 'percent', w: 72 },
  { key: 'roa', label: 'ROA', category: 'Financial Health', format: 'percent', w: 72 },
  { key: 'roic', label: 'ROIC', category: 'Financial Health', format: 'percent', w: 72 },
  { key: 'grossMargin', label: 'Gross M', category: 'Financial Health', format: 'percent', w: 84 },
  { key: 'operatingMargin', label: 'Op M', category: 'Financial Health', format: 'percent', w: 78 },
  { key: 'netMargin', label: 'Net M', category: 'Financial Health', format: 'percent', w: 78 },

  { key: 'structure', label: 'Structure', category: 'Structure', format: 'structure', w: 120 },
  { key: 'structureGrade', label: 'Grade', category: 'Structure', format: 'grade', w: 64 },
];

const DEFAULT_VISIBLE_COLUMN_KEYS = [
  'symbol', 'price', 'changePercent', 'structure', 'structureGrade',
  'relativeVolume', 'gapPercent', 'atrPercent', 'volume', 'marketCap',
];

function formatColumnValue(row, col) {
  const value = row?.[col.key];
  if (col.format === 'price') return fmtPrice(Number(value));
  if (col.format === 'percent') return fmtPct(Number(value));
  if (col.format === 'percent1') return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '–';
  if (col.format === 'large') return fmtLarge(Number(value));
  if (col.format === 'rvol') return fmtRvol(Number(value));
  if (col.format === 'num1') return fmtNum(Number(value), 1);
  if (col.format === 'num2') return fmtNum(Number(value), 2);
  if (value == null || value === '') return '–';
  return String(value);
}

function ResultsTable({ rows, columns, sortField, sortDir, onSort, onRowClick, selectedSymbol, addedSymbols, onColumnReorder }) {
  const dragColKeyRef = useRef(null);
  const draggingRef = useRef(false);

  const thSt = key => ({
    padding: '7px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.05em', background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-color)', cursor: 'pointer',
    whiteSpace: 'nowrap', userSelect: 'none', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1,
    color: sortField === key ? 'var(--accent-blue)' : 'var(--text-muted)',
  });

  const doSort = key => onSort(key, sortField === key && sortDir === 'desc' ? 'asc' : 'desc');

  const handleHeaderClick = (key) => {
    if (draggingRef.current) {
      draggingRef.current = false;
      return;
    }
    doSort(key);
  };

  const handleDragStart = (key) => {
    dragColKeyRef.current = key;
    draggingRef.current = true;
  };

  const handleDrop = (targetKey) => {
    const sourceKey = dragColKeyRef.current;
    dragColKeyRef.current = null;
    if (!sourceKey || sourceKey === targetKey) return;
    onColumnReorder?.(sourceKey, targetKey);
  };

  return (
    <table className="min-w-[900px]" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <colgroup>
        {columns.map(c => <col key={c.key} style={{ width: c.w }} />)}
      </colgroup>
      <thead>
        <tr>
          {columns.map(col => (
            <th
              key={col.key}
              style={thSt(col.key)}
              onClick={() => handleHeaderClick(col.key)}
              draggable
              onDragStart={() => handleDragStart(col.key)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(col.key)}
              onDragEnd={() => {
                dragColKeyRef.current = null;
                setTimeout(() => {
                  draggingRef.current = false;
                }, 0);
              }}
              title="Drag to reorder"
            >
              {col.label}
              {sortField === col.key && (
                <span style={{ marginLeft: 2 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          const def   = STRUCTURE_DEFS.find(d => d.name === row.structure);
          const sc    = def ? sideColor(def.side) : 'var(--text-muted)';
          const isSel = selectedSymbol === row.symbol;
          const isAdded = addedSymbols?.has(row.symbol);

          return (
            <tr key={row.symbol} onClick={() => onRowClick(row)}
              style={{ cursor: 'pointer', background: isSel
                ? 'var(--bg-card-hover)'
                : isAdded
                  ? 'rgba(34,197,94,0.09)'
                  : 'transparent',
                borderBottom: '1px solid var(--border-color)',
                boxShadow: isAdded ? 'inset 3px 0 0 rgba(34,197,94,0.9)' : 'none' }}
              onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--bg-card)'; }}
              onMouseLeave={e => {
                if (!isSel) e.currentTarget.style.background = isAdded ? 'rgba(34,197,94,0.09)' : 'transparent';
              }}>

              {columns.map((col) => {
                if (col.key === 'symbol') {
                  return (
                    <td key={col.key} style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--accent-blue)', fontSize: 12,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.symbol}
                      {isAdded && (
                        <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: 'var(--accent-green)' }}>
                          NEW
                        </span>
                      )}
                    </td>
                  );
                }

                if (col.format === 'structure') {
                  return (
                    <td key={col.key} style={{ padding: '5px 8px' }}>
                      {row.structure ? (
                        <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                          background: `${sc}1a`, border: `1px solid ${sc}66`,
                          color: sc, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {def?.label || row.structure}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>–</span>}
                    </td>
                  );
                }

                if (col.format === 'grade') {
                  return (
                    <td key={col.key} style={{ padding: '5px 8px' }}>
                      {row.structureGrade ? (
                        <span style={{ display: 'inline-block', padding: '2px 5px', borderRadius: 4,
                          fontSize: 10, fontWeight: 800, color: gradeColor(row.structureGrade),
                          border: `1px solid ${gradeColor(row.structureGrade)}55` }}>
                          {row.structureGrade}
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>–</span>}
                    </td>
                  );
                }

                const value = row?.[col.key];
                const color =
                  col.key === 'changePercent' || col.key === 'gapPercent'
                    ? pctColor(Number(value))
                      : col.key === 'relativeVolume' && Number.isFinite(Number(value)) && Number(value) >= 2
                      ? 'var(--accent-blue)'
                      : 'var(--text-secondary)';

                return (
                  <td key={col.key} style={{ padding: '6px 8px', fontSize: 12, color }}>
                    {formatColumnValue(row, col)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ row, onClose }) {
  const def = STRUCTURE_DEFS.find(d => d.name === row?.structure);
  const sc  = def ? sideColor(def.side) : 'var(--text-muted)';

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  if (!row) return null;

  const MR = ({ label, value, color }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0',
      borderBottom: '1px solid var(--border-color)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</span>
    </div>
  );

  return (
    <div style={{ width: 300, flexShrink: 0, background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column',
      overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-color)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--accent-blue)',
            letterSpacing: '0.06em' }}>{row.symbol}</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              {fmtPrice(row.price)}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: pctColor(row.changePercent) }}>
              {fmtPct(row.changePercent)}
            </span>
          </div>
        </div>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 20, padding: 0, lineHeight: 1 }}>×</button>
      </div>

      {/* Structure badge + score */}
      {row.structure && (
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ padding: '4px 10px', borderRadius: 6,
              background: `${sc}1a`, border: `1px solid ${sc}66`,
              color: sc, fontSize: 12, fontWeight: 700 }}>
              {def?.label || row.structure}
            </span>
            {row.structureGrade && (
              <span style={{ padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 800,
                color: gradeColor(row.structureGrade),
                border: `1px solid ${gradeColor(row.structureGrade)}55` }}>
                {row.structureGrade}
              </span>
            )}
          </div>
          {Number.isFinite(row.structureScore) && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10,
                color: 'var(--text-muted)', marginBottom: 3 }}>
                <span>Score</span><span>{row.structureScore}/100</span>
              </div>
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 4, height: 6 }}>
                <div style={{ width: `${row.structureScore}%`, height: '100%', borderRadius: 4,
                  background: sc, transition: 'width 0.3s' }} />
              </div>
            </div>
          )}
          {row.structureExplanation && (
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {row.structureExplanation}
            </p>
          )}
        </div>
      )}

      {/* Key metrics */}
      <div style={{ padding: '10px 14px', flex: 1 }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 6 }}>Key Metrics</div>
        <MR label="Relative Volume" value={row.relativeVolume ?? '-'}
          color={Number.isFinite(row.relativeVolume) && row.relativeVolume >= 2
            ? 'var(--accent-blue)' : undefined} />
        <MR label="Gap %" value={fmtPct(row.gapPercent)} color={pctColor(row.gapPercent)} />
        <MR label="ATR %" value={Number.isFinite(row.atrPercent) ? `${row.atrPercent.toFixed(2)}%` : '–'} />
        <MR label="RSI 14" value={fmtNum(row.rsi14, 1)} />
        <MR label="Volume" value={fmtLarge(row.volume)} />
        <MR label="Mkt Cap" value={fmtLarge(row.marketCap)} />
        <MR label="Float" value={Number.isFinite(row.floatShares) ? fmtLarge(row.floatShares) : '–'} />
        <MR label="Avg Vol 30d" value={Number.isFinite(row.avgVolume30d) ? fmtLarge(row.avgVolume30d) : '–'} />
        {row.vwap != null && <MR label="VWAP" value={fmtPrice(row.vwap)} />}
        {row.openingRangeHigh != null && (
          <MR label="OR High / Low"
            value={`${fmtPrice(row.openingRangeHigh)} / ${fmtPrice(row.openingRangeLow)}`} />
        )}
        <MR label="Exchange" value={row.exchange || '–'} />
        <MR label="Sector" value={row.sector || '–'} />
      </div>

      {/* Watchlist button */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-color)' }}>
        <button
          onClick={() => authFetch('/api/profile/watchlist', {
            method: 'POST', body: JSON.stringify({ symbol: row.symbol }),
          }).catch(() => {})}
          style={{ width: '100%', padding: '7px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', background: 'var(--accent-blue)', border: 'none', color: '#fff' }}>
          + Add to Watchlist
        </button>
      </div>
    </div>
  );
}

// ─── Pagination bar ───────────────────────────────────────────────────────────

function PagBtn({ children, disabled, onClick }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ ...btnSt, opacity: disabled ? 0.35 : 1, cursor: disabled ? 'default' : 'pointer',
        padding: '3px 10px', fontSize: 13 }}>
      {children}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function getInit() {
  const s = loadState();
  return {
    activeFilterIds: s?.activeFilterIds || [],
    filterValues:    s?.filterValues    || {},
    sortField:       s?.sortField       || 'relativeVolume',
    sortDir:         s?.sortDir         || 'desc',
    savedPresets:    s?.savedPresets    || [],
    pageSize:        DEFAULT_PAGE_SIZE,
    filterPanelWidth: s?.filterPanelWidth || 280,
    visibleColumnKeys: Array.isArray(s?.visibleColumnKeys) && s.visibleColumnKeys.length
      ? s.visibleColumnKeys
      : DEFAULT_VISIBLE_COLUMN_KEYS,
    bucketSelection: s?.bucketSelection || {
      common: true,
      etf: false,
      adr: false,
      preferred: false,
    },
  };
}

export default function ScreenerV3() {
  const init = getInit();

  const [activeFilterIds, setActiveFilterIds] = useState(init.activeFilterIds);
  const [filterValues,    setFilterValues]    = useState(init.filterValues);
  const [sortField,       setSortField]       = useState(init.sortField);
  const [sortDir,         setSortDir]         = useState(init.sortDir);
  const [savedPresets,    setSavedPresets]    = useState(init.savedPresets);
  const [pageSize,        setPageSize]        = useState(init.pageSize);
  const [filterPanelWidth, setFilterPanelWidth] = useState(init.filterPanelWidth);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(init.visibleColumnKeys);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [bucketSelection, setBucketSelection] = useState(init.bucketSelection);
  const [tickerSearch,    setTickerSearch]    = useState('');

  const [page,        setPage]        = useState(0);
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [deltaInfo,   setDeltaInfo]   = useState({ added: [], dropped: [] });
  const [exporting,   setExporting]   = useState(false);

  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const deltaClearRef = useRef(null);
  const prevSymbolsRef = useRef(null);
  const payloadLoggedRef = useRef(false);
  const bodyRef = useRef(null);
  const resizingRef = useRef(false);

  // Build fetch URL from current state
  const buildPagedUrl = useCallback((requestLimit, requestOffset) => {
    const activeQuery = buildQuery(activeFilterIds, filterValues);
    const selectedBuckets = Object.entries(bucketSelection)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key);
    const safeBuckets = selectedBuckets.length ? selectedBuckets : ['common'];
    const queryMap = {
      minPrice: 'priceMin',
      maxPrice: 'priceMax',
      minMarketCap: 'marketCapMin',
      maxMarketCap: 'marketCapMax',
      minRelativeVolume: 'rvolMin',
      maxRelativeVolume: 'rvolMax',
      minVolume: 'volumeMin',
      minGapPercent: 'gapMin',
      maxGapPercent: 'gapMax',
    };

    const params = new URLSearchParams();

    Object.entries(activeQuery).forEach(([key, value]) => {
      if (value == null || value === '') return;
      const mappedKey = queryMap[key] || key;
      params.set(mappedKey, String(value));
    });

    params.set('bucket', safeBuckets.join(','));

    params.set('limit', String(requestLimit));
    params.set('offset', String(requestOffset));

    return `/api/v3/screener/technical?${params.toString()}`;
  }, [activeFilterIds, filterValues, bucketSelection]);

  const buildUrl = useCallback(() => {
    return buildPagedUrl(pageSize, page * pageSize);
  }, [buildPagedUrl, page, pageSize]);

  const fetchData = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const res  = await authFetch(buildUrl(), { signal: abortRef.current.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const rawQuotes = Array.isArray(json?.data) ? json.data : [];

      if (!payloadLoggedRef.current && rawQuotes.length > 0) {
        console.log('Screener V3 payload sample:', rawQuotes[0]);
        console.log(typeof rawQuotes[0]?.price);
        console.log(typeof rawQuotes[0]?.relativeVolume);
        payloadLoggedRef.current = true;
      }

      const normalizedRows = rawQuotes.map((item) => {
        const price = toFiniteOrNull(item?.price);
        const volume = toFiniteOrNull(item?.volume);
        const change = toFiniteOrNull(item?.change);
        const changePercent = toFiniteOrNull(item?.changePercent);
        const marketCap = toFiniteOrNull(item?.marketCap);
        const floatShares = toFiniteOrNull(item?.float);
        const avgVolume30d = toFiniteOrNull(item?.avgVolume);
        const relativeVolumeRaw = item?.relativeVolume ?? item?.rvol;
        const relativeVolume = relativeVolumeRaw != null ? toFiniteOrNull(relativeVolumeRaw) : null;
        const gapPercent = toFiniteOrNull(item?.gapPercent);
        const dollarVolume = Number.isFinite(price) && Number.isFinite(volume) ? price * volume : null;

        return {
          ...item,
          symbol: String(item?.symbol || ''),
          name: item?.name || item?.companyName || String(item?.symbol || ''),
          price: Number.isFinite(price) ? price : null,
          volume: Number.isFinite(volume) ? volume : null,
          change: Number.isFinite(change) ? change : null,
          changePercent: Number.isFinite(changePercent) ? changePercent : null,
          changesPercentage: Number.isFinite(changePercent) ? changePercent : item?.changesPercentage ?? null,
          marketCap: Number.isFinite(marketCap) ? marketCap : null,
          floatShares: Number.isFinite(floatShares) ? floatShares : null,
          float: Number.isFinite(floatShares) ? floatShares : null,
          avgVolume: Number.isFinite(avgVolume30d) ? avgVolume30d : toFiniteOrNull(item?.avgVolume),
          avgVolume30d: Number.isFinite(avgVolume30d) ? avgVolume30d : toFiniteOrNull(item?.avgVolume),
          rvol: Number.isFinite(relativeVolume) ? relativeVolume : null,
          rvolConfidence: item?.rvolConfidence || null,
          relativeVolume: Number.isFinite(relativeVolume) ? relativeVolume : null,
          gapPercent: Number.isFinite(gapPercent) ? gapPercent : null,
          dollarVolume: Number.isFinite(toFiniteOrNull(item?.dollarVolume)) ? toFiniteOrNull(item?.dollarVolume) : (Number.isFinite(dollarVolume) ? dollarVolume : null),
          exchange: item?.exchange || item?.exchangeShortName || null,
        };
      });

      const nextSymbols = new Set(normalizedRows.map((r) => r.symbol).filter(Boolean));
      const prevSymbols = prevSymbolsRef.current;
      if (prevSymbols) {
        const added = Array.from(nextSymbols).filter((symbol) => !prevSymbols.has(symbol));
        const dropped = Array.from(prevSymbols).filter((symbol) => !nextSymbols.has(symbol));
        if (added.length || dropped.length) {
          setDeltaInfo({ added, dropped });
          if (deltaClearRef.current) clearTimeout(deltaClearRef.current);
          deltaClearRef.current = setTimeout(() => {
            setDeltaInfo({ added: [], dropped: [] });
          }, 20000);
        }
      }
      prevSymbolsRef.current = nextSymbols;

      setData({
        results: normalizedRows,
        total: Number.isFinite(Number(json?.total)) ? Number(json.total) : normalizedRows.length,
        limit: Number.isFinite(Number(json?.limit)) ? Number(json.limit) : pageSize,
        offset: Number.isFinite(Number(json?.offset)) ? Number(json.offset) : page * pageSize,
        count: Number.isFinite(Number(json?.count)) ? Number(json.count) : normalizedRows.length,
        environment: json?.environment || null,
        filtersAdjusted: json?.filtersAdjusted || [],
      });
      setSelectedRow((prev) => {
        if (!prev?.symbol) return prev;
        const next = normalizedRows.find((row) => row.symbol === prev.symbol);
        return next || null;
      });
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [buildUrl, page, pageSize]);

  // Fetch on deps change
  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh on page 0
  useEffect(() => {
    if (page !== 0) return;
    timerRef.current = setInterval(fetchData, AUTO_REFRESH);
    return () => clearInterval(timerRef.current);
  }, [page, fetchData]);

  useEffect(() => () => {
    if (deltaClearRef.current) clearTimeout(deltaClearRef.current);
  }, []);

  // Persist state
  useEffect(() => {
    saveState({
      activeFilterIds,
      filterValues,
      sortField,
      sortDir,
      savedPresets,
      pageSize,
      filterPanelWidth,
      visibleColumnKeys,
      bucketSelection,
    });
  }, [activeFilterIds, filterValues, sortField, sortDir, savedPresets, pageSize, filterPanelWidth, visibleColumnKeys, bucketSelection]);

  const visibleColumns = useMemo(() => {
    const byKey = new Map(COLUMN_REGISTRY.map((col) => [col.key, col]));
    const selected = visibleColumnKeys
      .map((key) => byKey.get(key))
      .filter(Boolean);
    return selected.length ? selected : COLUMN_REGISTRY.filter((col) => DEFAULT_VISIBLE_COLUMN_KEYS.includes(col.key));
  }, [visibleColumnKeys]);

  const toggleColumnKey = useCallback((key, checked) => {
    setVisibleColumnKeys((prev) => {
      if (checked) return Array.from(new Set([...prev, key]));
      const next = prev.filter((v) => v !== key);
      return next.length ? next : prev;
    });
  }, []);

  const reorderVisibleColumns = useCallback((sourceKey, targetKey) => {
    setVisibleColumnKeys((prev) => {
      const sourceIndex = prev.indexOf(sourceKey);
      const targetIndex = prev.indexOf(targetKey);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return prev;
      const next = [...prev];
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, sourceKey);
      return next;
    });
  }, []);

  useEffect(() => {
    function onMouseMove(e) {
      if (!resizingRef.current || !bodyRef.current) return;

      const rect = bodyRef.current.getBoundingClientRect();
      const maxByContainer = Math.max(FILTER_PANEL_MIN_WIDTH, rect.width - 320);
      const maxWidth = Math.min(FILTER_PANEL_MAX_WIDTH, maxByContainer);
      const next = Math.min(maxWidth, Math.max(FILTER_PANEL_MIN_WIDTH, e.clientX - rect.left));
      setFilterPanelWidth(next);
    }

    function onMouseUp() {
      resizingRef.current = false;
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const getRangeValue = useCallback((row, key) => {
    switch (key) {
      case 'minPrice':
      case 'maxPrice':
        return row.price;
      case 'minMarketCap':
      case 'maxMarketCap':
        return row.marketCap;
      case 'minFloat':
      case 'maxFloat':
        return row.floatShares;
      case 'minChangePercent':
      case 'maxChangePercent':
        return row.changePercent;
      case 'minGapPercent':
      case 'maxGapPercent':
        return row.gapPercent;
      case 'minVolume':
      case 'maxVolume':
        return row.volume;
      case 'minDollarVolume':
      case 'maxDollarVolume':
        return row.dollarVolume;
      case 'minRelativeVolume':
      case 'maxRelativeVolume':
        return row.relativeVolume;
      case 'minRsi14':
      case 'maxRsi14':
        return row.rsi14;
      case 'minAtrPercent':
      case 'maxAtrPercent':
        return row.atrPercent;
      default:
        return undefined;
    }
  }, []);

  const filteredRows = useMemo(() => {
    return Array.isArray(data?.results) ? data.results : [];
  }, [data]);

  const getSortableValue = useCallback((row, field) => {
    if (field === 'relativeVolume') return row.relativeVolume;
    return row?.[field];
  }, []);

  // Client-side sort (full filtered dataset)
  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const av = getSortableValue(a, sortField);
      const bv = getSortableValue(b, sortField);

      if (sortField === 'price') {
        const an = Number(av);
        const bn = Number(bv);
        const safeA = Number.isFinite(an) ? an : Number.NEGATIVE_INFINITY;
        const safeB = Number.isFinite(bn) ? bn : Number.NEGATIVE_INFINITY;
        return sortDir === 'asc' ? safeA - safeB : safeB - safeA;
      }

      const an = Number(av);
      const bn = Number(bv);
      if (Number.isFinite(an) && Number.isFinite(bn)) {
        return sortDir === 'asc' ? an - bn : bn - an;
      }

      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [filteredRows, sortField, sortDir, getSortableValue]);

  const displayedRows = useMemo(() => {
    const term = String(tickerSearch || '').trim().toLowerCase();
    if (!term) return sortedRows;

    return sortedRows.filter((stock) => stock.symbol?.toLowerCase().includes(term));
  }, [sortedRows, tickerSearch]);

  const totalRows = Number.isFinite(Number(data?.total)) ? Number(data.total) : filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const pagedRows = useMemo(() => {
    return displayedRows;
  }, [displayedRows]);

  const currentOffset = page * pageSize;
  const currentCount = Number.isFinite(Number(data?.count)) ? Number(data.count) : pagedRows.length;
  const showingStart = totalRows > 0 ? currentOffset + 1 : 0;
  const showingEnd = totalRows > 0 ? currentOffset + currentCount : 0;

  const handleSort = (field, dir) => { setSortField(field); setSortDir(dir); };

  const handleClearAllFilters = useCallback(() => {
    setActiveFilterIds([]);
    setFilterValues({});
    setTickerSearch('');
    setBucketSelection({ common: true, etf: false, adr: false, preferred: false });
    setPage(0);
  }, []);

  const handleApplyFilters = useCallback(() => {
    if (page !== 0) {
      setPage(0);
      return;
    }
    fetchData();
  }, [page, fetchData]);

  const toggleBucket = useCallback((bucketKey, checked) => {
    setBucketSelection((prev) => {
      const next = { ...prev, [bucketKey]: checked };
      const hasAny = Object.values(next).some(Boolean);
      if (!hasAny) next.common = true;
      return next;
    });
    setPage(0);
  }, []);

  const handleExportCsv = useCallback(async () => {
    if (exporting) return;
    setExporting(true);

    try {
      const activeQuery = buildQuery(activeFilterIds, filterValues);
      const selectedBuckets = Object.entries(bucketSelection)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([key]) => key);

      const params = new URLSearchParams();
      const safeBuckets = selectedBuckets.length ? selectedBuckets : ['common'];
      params.set('bucket', safeBuckets.join(','));
      params.set('format', 'csv');

      const mapping = {
        minPrice: 'priceMin',
        maxPrice: 'priceMax',
        minMarketCap: 'marketCapMin',
        maxMarketCap: 'marketCapMax',
        minRelativeVolume: 'rvolMin',
        maxRelativeVolume: 'rvolMax',
        minVolume: 'volumeMin',
        minGapPercent: 'gapMin',
        maxGapPercent: 'gapMax',
      };

      Object.entries(activeQuery).forEach(([key, value]) => {
        if (value == null || value === '') return;
        params.set(mapping[key] || key, String(value));
      });

      const symbolTerm = String(tickerSearch || '').trim().toUpperCase();
      if (symbolTerm) params.set('symbol', symbolTerm);

      const exportUrl = `/api/v4/export?${params.toString()}`;
      const response = await authFetch(exportUrl);
      if (!response.ok) {
        const msg = await response.text();
        throw new Error(msg || `HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename = filenameMatch?.[1] || `screener-v4-export-${Date.now()}.csv`;

      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('CSV export failed', err);
      alert(`CSV export failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setExporting(false);
    }
  }, [activeFilterIds, bucketSelection, exporting, filterValues, tickerSearch]);

  // Preset handlers
  const handleSavePreset = (name, ids, vals) => {
    setSavedPresets(prev => [...prev.filter(p => p.name !== name), { name, activeFilterIds: ids, filterValues: vals }]);
  };
  const handleLoadPreset  = p  => { setActiveFilterIds(p.activeFilterIds || []); setFilterValues(p.filterValues || {}); setPage(0); };
  const handleDeletePreset = i => setSavedPresets(prev => prev.filter((_, j) => j !== i));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
      background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>

      {/* SPY State bar */}
      <SpyPill env={data?.environment} />

      {/* Three-panel body */}
      <div ref={bodyRef} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: filter panel */}
        <FilterPanel
          activeFilterIds={activeFilterIds}
          filterValues={filterValues}
          onFilterIdsChange={ids => { setActiveFilterIds(ids); setPage(0); }}
          onFilterValuesChange={vals => { setFilterValues(vals); setPage(0); }}
          onApplyFilters={handleApplyFilters}
          onClearFilters={handleClearAllFilters}
          adjustments={data?.filtersAdjusted}
          totalCount={totalRows}
          savedPresets={savedPresets}
          onSavePreset={handleSavePreset}
          onLoadPreset={handleLoadPreset}
          onDeletePreset={handleDeletePreset}
          width={filterPanelWidth}
          onResizeStart={() => { resizingRef.current = true; }}
        />

        {/* Center: table + toolbar */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          minWidth: 0 }}>

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 14px', borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <input
                type="text"
                placeholder="Search ticker (e.g. AAPL)"
                value={tickerSearch}
                onChange={(e) => {
                  setTickerSearch(e.target.value);
                  setPage(0);
                }}
                style={{
                  ...inputSt,
                  width: 180,
                  minWidth: 160,
                  fontSize: 12,
                  padding: '5px 8px',
                }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={Boolean(bucketSelection.common)}
                  onChange={(e) => toggleBucket('common', e.target.checked)}
                />
                Common Stocks
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={Boolean(bucketSelection.etf)}
                  onChange={(e) => toggleBucket('etf', e.target.checked)}
                />
                ETFs
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={Boolean(bucketSelection.adr)}
                  onChange={(e) => toggleBucket('adr', e.target.checked)}
                />
                ADRs
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={Boolean(bucketSelection.preferred)}
                  onChange={(e) => toggleBucket('preferred', e.target.checked)}
                />
                Preferred
              </label>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {loading ? 'Loading…'
                  : error ? <span style={{ color: 'var(--accent-red)' }}>Error: {error}</span>
                  : data  ? `Showing ${showingStart.toLocaleString()}–${showingEnd.toLocaleString()} of ${totalRows.toLocaleString()}`
                  : '–'}
              </span>
              {(deltaInfo.added.length > 0 || deltaInfo.dropped.length > 0) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                  {deltaInfo.added.length > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--accent-green)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      + {deltaInfo.added.slice(0, 6).join(', ')}{deltaInfo.added.length > 6 ? '…' : ''}
                    </span>
                  )}
                  {deltaInfo.dropped.length > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--accent-red)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      − {deltaInfo.dropped.slice(0, 6).join(', ')}{deltaInfo.dropped.length > 6 ? '…' : ''}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
              <button
                onClick={() => setShowColumnMenu((prev) => !prev)}
                style={{ ...btnSt, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                Columns ▾
              </button>
              {showColumnMenu && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  zIndex: 20,
                  width: 280,
                  maxHeight: 340,
                  overflowY: 'auto',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                  padding: 10,
                }}>
                  {COLUMN_REGISTRY.map((col) => (
                    <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 11, color: 'var(--text-secondary)' }}>
                      <input
                        type="checkbox"
                        checked={visibleColumnKeys.includes(col.key)}
                        onChange={(e) => toggleColumnKey(col.key, e.target.checked)}
                      />
                      <span style={{ color: 'var(--text-primary)' }}>{col.label}</span>
                      <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{col.category}</span>
                    </label>
                  ))}
                </div>
              )}
              <button onClick={fetchData}
                style={{ ...btnSt, display: 'flex', alignItems: 'center', gap: 4 }}>
                ↻ Refresh
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                Tickers: {totalRows.toLocaleString()}
              </span>
              <button
                onClick={handleExportCsv}
                disabled={exporting || !totalRows}
                style={{
                  ...btnSt,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  opacity: exporting || !totalRows ? 0.5 : 1,
                  cursor: exporting || !totalRows ? 'default' : 'pointer',
                }}
              >
                {exporting ? '⭳ Exporting…' : '⭳ Export CSV'}
              </button>
            </div>
          </div>

          {/* Table scroll area */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
            {pagedRows.length > 0 ? (
              <ResultsTable
                rows={pagedRows}
                columns={visibleColumns}
                sortField={sortField} sortDir={sortDir}
                onSort={handleSort}
                onRowClick={setSelectedRow}
                selectedSymbol={selectedRow?.symbol}
                addedSymbols={new Set(deltaInfo.added)}
                onColumnReorder={reorderVisibleColumns}
              />
            ) : !loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', gap: 10 }}>
                <span style={{ fontSize: 32, color: 'var(--text-muted)' }}>◎</span>
                <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  {totalRows === 0
                    ? activeFilterIds.length > 0
                      ? 'No stocks match these filters'
                      : 'Universe is empty — waiting for data pipeline'
                    : 'No data available yet'}
                </span>
                {totalRows === 0 && activeFilterIds.length > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Try relaxing your criteria
                  </span>
                )}
              </div>
            ) : null}
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '7px', borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Page Size</span>
              <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 700 }}>25</span>
            </div>

            <PagBtn disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</PagBtn>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 64, textAlign: 'center' }}>
              {page + 1} / {totalPages}
            </span>
            <PagBtn disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>Next</PagBtn>
          </div>
        </div>

        {/* Right: detail slide-in */}
        {selectedRow && (
          <DetailPanel row={selectedRow} onClose={() => setSelectedRow(null)} />
        )}
      </div>
    </div>
  );
}
