import Card from '../shared/Card';
import AdaptiveBuilder from './AdaptiveBuilder';
import StructuredFilters from './StructuredFilters';

export default function FilterSidebar({
  mode,
  onModeChange,
  adaptiveProps,
  structuredProps,
}) {
  return (
    <Card className="h-[calc(100vh-170px)] w-full max-w-[320px] overflow-hidden rounded-2xl border border-[var(--border-color)] p-0 shadow-[0_8px_20px_rgba(12,14,18,0.12)]">
      <div className="flex border-b border-[var(--border-color)] p-2">
        <button
          type="button"
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'adaptive'
            ? 'bg-[rgba(74,158,255,0.18)] text-[var(--accent-blue)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
          }`}
          onClick={() => onModeChange('adaptive')}
        >
          Adaptive Builder
        </button>
        <button
          type="button"
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'structured'
            ? 'bg-[rgba(74,158,255,0.18)] text-[var(--accent-blue)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
          }`}
          onClick={() => onModeChange('structured')}
        >
          Structured Filters
        </button>
      </div>

      <div className="h-[calc(100%-52px)] overflow-y-auto p-3">
        {mode === 'adaptive' ? (
          <AdaptiveBuilder {...adaptiveProps} />
        ) : (
          <StructuredFilters {...structuredProps} />
        )}
      </div>
    </Card>
  );
}
