import { useMemo, useState } from 'react';

const TABS = ['Descriptive', 'Fundamental', 'Technical', 'Volume', 'Catalyst', 'Earnings', 'All'];

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <select className="input-field h-9 w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

const numberRangeOptions = [
  { value: '0-2', label: '0 - 2' },
  { value: '2-5', label: '2 - 5' },
  { value: '5-10', label: '5 - 10' },
  { value: '10-25', label: '10 - 25' },
  { value: '25-50', label: '25 - 50' },
  { value: '50-200', label: '50 - 200' },
  { value: '200-999999', label: '200+' },
];

export default function StructuredFilters({ values, onChange, onApply, onClear, filterRegistry }) {
  const [activeTab, setActiveTab] = useState('Descriptive');

  const sectorOptions = useMemo(() => {
    const sectors = Array.isArray(filterRegistry?.sectors) ? filterRegistry.sectors : [];
    return sectors.map((sector) => ({ value: sector, label: sector }));
  }, [filterRegistry]);

  const countryOptions = useMemo(() => {
    const countries = Array.isArray(filterRegistry?.countries) ? filterRegistry.countries : [];
    return countries.map((country) => ({ value: country, label: country }));
  }, [filterRegistry]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-semibold ${activeTab === tab
              ? 'bg-[rgba(74,158,255,0.2)] text-[var(--accent-blue)]'
              : 'bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {(activeTab === 'Descriptive' || activeTab === 'All') && (
          <>
            <SelectField
              label="Exchange"
              value={values.exchange}
              options={[
                { value: 'NASDAQ', label: 'NASDAQ' },
                { value: 'NYSE', label: 'NYSE' },
                { value: 'AMEX', label: 'AMEX' },
              ]}
              onChange={(value) => onChange('exchange', value)}
            />
            <SelectField
              label="Country"
              value={values.country}
              options={countryOptions}
              onChange={(value) => onChange('country', value)}
            />
            <SelectField
              label="Sector"
              value={values.sector}
              options={sectorOptions}
              onChange={(value) => onChange('sector', value)}
            />
            <SelectField
              label="Price Range"
              value={values.priceRange}
              options={numberRangeOptions}
              onChange={(value) => onChange('priceRange', value)}
            />
          </>
        )}

        {(activeTab === 'Fundamental' || activeTab === 'All') && (
          <>
            <SelectField
              label="Market Cap"
              value={values.marketCapRange}
              options={numberRangeOptions}
              onChange={(value) => onChange('marketCapRange', value)}
            />
            <SelectField
              label="Float"
              value={values.floatRange}
              options={numberRangeOptions}
              onChange={(value) => onChange('floatRange', value)}
            />
          </>
        )}

        {(activeTab === 'Technical' || activeTab === 'All') && (
          <>
            <SelectField
              label="RSI"
              value={values.rsiRange}
              options={[
                { value: '0-30', label: 'Oversold (<30)' },
                { value: '30-70', label: 'Neutral (30-70)' },
                { value: '70-100', label: 'Overbought (>70)' },
              ]}
              onChange={(value) => onChange('rsiRange', value)}
            />
            <SelectField
              label="VWAP Relation"
              value={values.vwapRelation}
              options={[
                { value: 'above', label: 'Price Above VWAP' },
                { value: 'below', label: 'Price Below VWAP' },
              ]}
              onChange={(value) => onChange('vwapRelation', value)}
            />
          </>
        )}

        {(activeTab === 'Volume' || activeTab === 'All') && (
          <>
            <SelectField
              label="Relative Volume"
              value={values.rvolRange}
              options={[
                { value: '1-2', label: '1 - 2' },
                { value: '2-3', label: '2 - 3' },
                { value: '3-999', label: '3+' },
              ]}
              onChange={(value) => onChange('rvolRange', value)}
            />
            <SelectField
              label="Intraday Volume Surge"
              value={values.volumeShockRange}
              options={[
                { value: '1-2', label: '1 - 2' },
                { value: '2-3', label: '2 - 3' },
                { value: '3-999', label: '3+' },
              ]}
              onChange={(value) => onChange('volumeShockRange', value)}
            />
          </>
        )}

        {(activeTab === 'Catalyst' || activeTab === 'All') && (
          <>
            <SelectField
              label="Catalyst Type"
              value={values.catalystType}
              options={[
                { value: 'earnings', label: 'Earnings' },
                { value: 'news', label: 'News' },
                { value: 'upgrade', label: 'Upgrade / Downgrade' },
              ]}
              onChange={(value) => onChange('catalystType', value)}
            />
            <SelectField
              label="News Sentiment"
              value={values.sentiment}
              options={[
                { value: 'positive', label: 'Positive' },
                { value: 'neutral', label: 'Neutral' },
                { value: 'negative', label: 'Negative' },
              ]}
              onChange={(value) => onChange('sentiment', value)}
            />
          </>
        )}

        {(activeTab === 'Earnings' || activeTab === 'All') && (
          <>
            <SelectField
              label="Days Until Earnings"
              value={values.daysUntilEarnings}
              options={[
                { value: '0-3', label: '0 - 3 days' },
                { value: '4-7', label: '4 - 7 days' },
                { value: '8-30', label: '8 - 30 days' },
              ]}
              onChange={(value) => onChange('daysUntilEarnings', value)}
            />
            <SelectField
              label="Expected Move"
              value={values.expectedMoveRange}
              options={[
                { value: '0-2', label: '0 - 2%' },
                { value: '2-5', label: '2 - 5%' },
                { value: '5-999', label: '5%+' },
              ]}
              onChange={(value) => onChange('expectedMoveRange', value)}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary rounded-lg px-3 py-2 text-sm" onClick={onApply}>Apply Filters</button>
        <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={onClear}>Clear</button>
      </div>
    </div>
  );
}
