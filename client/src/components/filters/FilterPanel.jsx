import FilterDropdown from './FilterDropdown';
import FilterRangeSlider from './FilterRangeSlider';
import FilterTagSelector from './FilterTagSelector';
import FilterPresetManager from './FilterPresetManager';

const CATALYST_TAGS = ['earnings', 'upgrade', 'downgrade', 'guidance', 'merger', 'product'];
const SECTORS = ['Technology', 'Financial', 'Healthcare', 'Energy', 'Consumer Defensive', 'Industrials'];

export default function FilterPanel({ filters, updateRange, updateMulti, clearFilters, presets, savePreset, loadPreset, deletePreset }) {
  return (
    <aside className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">Global Filters</h3>
        <button type="button" onClick={clearFilters} className="text-xs text-slate-400 hover:text-slate-200">Clear</button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <FilterRangeSlider label="Market Cap" value={filters.marketCap} onChange={(range) => updateRange('marketCap', range)} min={0} max={5000000000000} step={1000000} />
        <FilterRangeSlider label="Relative Volume" value={filters.relativeVolume} onChange={(range) => updateRange('relativeVolume', range)} min={0} max={20} step={0.1} />
        <FilterRangeSlider label="Price" value={filters.price} onChange={(range) => updateRange('price', range)} min={0} max={1000} step={0.1} />
        <FilterDropdown label="Sector" value={filters.sector} onChange={(values) => updateMulti('sector', values)} options={SECTORS} multi />
        <FilterRangeSlider label="Float" value={filters.float} onChange={(range) => updateRange('float', range)} min={0} max={20000000000} step={1000000} />
        <FilterRangeSlider label="Gap %" value={filters.gapPercent} onChange={(range) => updateRange('gapPercent', range)} min={-50} max={200} step={0.1} />
        <FilterRangeSlider label="Short Interest" value={filters.shortInterest} onChange={(range) => updateRange('shortInterest', range)} min={0} max={100} step={0.1} />
        <FilterRangeSlider label="Earnings Proximity" value={filters.earningsProximity} onChange={(range) => updateRange('earningsProximity', range)} min={0} max={90} step={1} />
        <FilterRangeSlider label="Institutional Ownership" value={filters.institutionalOwnership} onChange={(range) => updateRange('institutionalOwnership', range)} min={0} max={100} step={0.1} />
      </div>

      <FilterTagSelector label="News Catalysts" value={filters.newsCatalysts} onChange={(values) => updateMulti('newsCatalysts', values)} options={CATALYST_TAGS} />

      <FilterPresetManager presets={presets} onSave={savePreset} onLoad={loadPreset} onDelete={deletePreset} />
    </aside>
  );
}
