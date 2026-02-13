import { SOURCE_COLORS } from '../../utils/constants';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'screener', label: 'Screener' },
  { key: 'premarket', label: 'Pre-Market' },
  { key: 'news', label: 'News' },
  { key: 'expected-move', label: 'Expected Move' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'research', label: 'Research' },
  { key: 'manual', label: 'Manual' },
];

export default function SourceFilter({ active, onChange }) {
  return (
    <div className="source-filter">
      {FILTERS.map(f => {
        const isActive = active === f.key;
        const colors = f.key !== 'all' ? SOURCE_COLORS[f.key] : null;
        return (
          <button
            key={f.key}
            className={`source-filter__pill${isActive ? ' source-filter__pill--active' : ''}`}
            style={isActive && colors ? { background: colors.color, color: '#fff' } : undefined}
            onClick={() => onChange(f.key)}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
