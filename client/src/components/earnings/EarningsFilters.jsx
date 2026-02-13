import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const MCAP_OPTIONS = [
  { label: 'Any Market Cap', min: '', max: '' },
  { label: 'Nano (<$50M)', min: 0, max: 50e6 },
  { label: 'Micro ($50M–$300M)', min: 50e6, max: 300e6 },
  { label: 'Small ($300M–$2B)', min: 300e6, max: 2e9 },
  { label: 'Mid ($2B–$10B)', min: 2e9, max: 10e9 },
  { label: 'Large ($10B–$200B)', min: 10e9, max: 200e9 },
  { label: 'Mega (>$200B)', min: 200e9, max: '' },
  { label: 'Custom…', custom: true },
];

const PRICE_OPTIONS = [
  { label: 'Any Price', min: '', max: '' },
  { label: 'Under $10', min: '', max: 10 },
  { label: '$10–$50', min: 10, max: 50 },
  { label: '$50–$200', min: 50, max: 200 },
  { label: 'Over $200', min: 200, max: '' },
  { label: 'Custom…', custom: true },
];

const AVGVOL_PRESETS = [
  { label: 'Any', min: '' },
  { label: '>300K', min: 300e3 },
  { label: '>1M', min: 1e6 },
  { label: '>5M', min: 5e6 },
];

const RVOL_PRESETS = [
  { label: 'Any', min: '' },
  { label: '>1.5x', min: 1.5 },
  { label: '>2x', min: 2 },
  { label: '>3x', min: 3 },
];

const FLOAT_PRESETS = [
  { label: 'Any', max: '' },
  { label: '<20M', max: 20e6 },
  { label: '<50M', max: 50e6 },
  { label: '<100M', max: 100e6 },
];

const SCORE_PRESETS = [
  { label: 'Any', min: '' },
  { label: '1+', min: 1 },
  { label: '3+ (Good)', min: 3 },
  { label: '5+ (Strong)', min: 5 },
];

function findMcapIndex(filters) {
  if (filters._mcapCustom) return MCAP_OPTIONS.length - 1;
  return MCAP_OPTIONS.findIndex(p => {
    if (p.custom) return false;
    return String(filters.marketCapMin ?? '') === String(p.min) && String(filters.marketCapMax ?? '') === String(p.max);
  });
}

function findPriceIndex(filters) {
  if (filters._priceCustom) return PRICE_OPTIONS.length - 1;
  return PRICE_OPTIONS.findIndex(p => {
    if (p.custom) return false;
    return String(filters.minPrice ?? '') === String(p.min) && String(filters.maxPrice ?? '') === String(p.max);
  });
}

export default function EarningsFilters({ filters, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const update = (key, value) => onChange({ ...filters, [key]: value });
  const updateMulti = (obj) => onChange({ ...filters, ...obj });

  const mcapIdx = findMcapIndex(filters);
  const priceIdx = findPriceIndex(filters);

  const handleMcapChange = (e) => {
    const idx = Number(e.target.value);
    const opt = MCAP_OPTIONS[idx];
    if (!opt) return;
    if (opt.custom) {
      updateMulti({ _mcapCustom: true });
    } else {
      updateMulti({ marketCapMin: opt.min, marketCapMax: opt.max, _mcapCustom: false });
    }
  };

  const handlePriceChange = (e) => {
    const idx = Number(e.target.value);
    const opt = PRICE_OPTIONS[idx];
    if (!opt) return;
    if (opt.custom) {
      updateMulti({ _priceCustom: true });
    } else {
      updateMulti({ minPrice: opt.min, maxPrice: opt.max, _priceCustom: false });
    }
  };

  const hasAdvancedFilter = filters.minAvgVolume || filters.minRvol || filters.maxFloat || filters.minScore;

  return (
    <div className="earnings-filters">
      {/* Row 1: Market Cap dropdown + Price dropdown */}
      <div className="earnings-filters__row">
        <span className="earnings-filters__label">Market Cap</span>
        <div className="ef-dropdown-group">
          <select className="ef-select" value={mcapIdx >= 0 ? mcapIdx : 0} onChange={handleMcapChange}>
            {MCAP_OPTIONS.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
          </select>
          {filters._mcapCustom && (
            <div className="ef-custom-range">
              <input type="number" className="ef-range-input" placeholder="Min ($)"
                value={filters.marketCapMin ?? ''} onChange={e => update('marketCapMin', e.target.value ? Number(e.target.value) : '')} />
              <span className="ef-range-sep">–</span>
              <input type="number" className="ef-range-input" placeholder="Max ($)"
                value={filters.marketCapMax ?? ''} onChange={e => update('marketCapMax', e.target.value ? Number(e.target.value) : '')} />
            </div>
          )}
        </div>

        <span className="earnings-filters__divider" />

        <span className="earnings-filters__label">Price</span>
        <div className="ef-dropdown-group">
          <select className="ef-select" value={priceIdx >= 0 ? priceIdx : 0} onChange={handlePriceChange}>
            {PRICE_OPTIONS.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
          </select>
          {filters._priceCustom && (
            <div className="ef-custom-range">
              <input type="number" className="ef-range-input" placeholder="Min"
                value={filters.minPrice ?? ''} onChange={e => update('minPrice', e.target.value ? Number(e.target.value) : '')} />
              <span className="ef-range-sep">–</span>
              <input type="number" className="ef-range-input" placeholder="Max"
                value={filters.maxPrice ?? ''} onChange={e => update('maxPrice', e.target.value ? Number(e.target.value) : '')} />
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Time pills + Search */}
      <div className="earnings-filters__row">
        <span className="earnings-filters__label">Time</span>
        <div className="earnings-filters__pills">
          {[{ label: 'All', value: '' }, { label: 'BMO', value: 'bmo' }, { label: 'AMC', value: 'amc' }, { label: 'TNS', value: 'tns' }].map(t => (
            <button
              key={t.value}
              className={`ef-pill${filters.time === t.value ? ' ef-pill--active' : ''}`}
              onClick={() => update('time', t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="earnings-filters__search">
          <input
            type="text" placeholder="Ticker or name..."
            value={filters.search}
            onChange={e => update('search', e.target.value)}
            className="input-field"
          />
        </div>
      </div>

      {/* Advanced toggle */}
      <button
        className="earnings-filters__toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        Advanced Filters
        {hasAdvancedFilter && <span className="earnings-filters__active-dot" />}
      </button>

      {expanded && (
        <div className="earnings-filters__advanced">
          {/* Avg Volume + RVOL */}
          <div className="earnings-filters__row">
            <span className="earnings-filters__label">Avg Volume</span>
            <div className="earnings-filters__pills">
              {AVGVOL_PRESETS.map((p, i) => (
                <button
                  key={i}
                  className={`ef-pill${String(filters.minAvgVolume ?? '') === String(p.min) ? ' ef-pill--active' : ''}`}
                  onClick={() => update('minAvgVolume', p.min)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="earnings-filters__divider" />
            <span className="earnings-filters__label">RVOL</span>
            <div className="earnings-filters__pills">
              {RVOL_PRESETS.map((p, i) => (
                <button
                  key={i}
                  className={`ef-pill${String(filters.minRvol ?? '') === String(p.min) ? ' ef-pill--active' : ''}`}
                  onClick={() => update('minRvol', p.min)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Float + Score */}
          <div className="earnings-filters__row">
            <span className="earnings-filters__label">Float</span>
            <div className="earnings-filters__pills">
              {FLOAT_PRESETS.map((p, i) => (
                <button
                  key={i}
                  className={`ef-pill${String(filters.maxFloat ?? '') === String(p.max) ? ' ef-pill--active' : ''}`}
                  onClick={() => update('maxFloat', p.max)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="earnings-filters__divider" />
            <span className="earnings-filters__label">Score</span>
            <div className="earnings-filters__pills">
              {SCORE_PRESETS.map((p, i) => (
                <button
                  key={i}
                  className={`ef-pill${String(filters.minScore ?? '') === String(p.min) ? ' ef-pill--active' : ''}`}
                  onClick={() => update('minScore', p.min)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
