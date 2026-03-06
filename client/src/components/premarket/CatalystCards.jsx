import Card from '../shared/Card';
import { sentimentTone, toneColor } from './utils';

const TAGS = [
  { key: 'earn', label: 'Earnings' },
  { key: 'fda', label: 'FDA' },
  { key: 'upgrade', label: 'Upgrade' },
  { key: 'acq', label: 'Acquisition' },
];

function inferTags(row) {
  const text = `${row?.catalyst_type || ''} ${row?.headline || ''}`.toLowerCase();
  return TAGS.filter((tag) => text.includes(tag.key)).map((tag) => tag.label);
}

export default function CatalystCards({ catalysts = [], onSelectSymbol }) {
  const rows = (Array.isArray(catalysts) ? catalysts : []).slice(0, 12);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.length === 0 ? <div className="muted">No catalysts available.</div> : null}
      {rows.map((row, idx) => {
        const symbol = String(row?.symbol || '').toUpperCase();
        const tone = sentimentTone(row?.sentiment);
        const tags = inferTags(row);
        return (
          <Card
            key={`${symbol}-${row?.published_at || idx}`}
            className={symbol ? 'cursor-pointer' : ''}
            role={symbol ? 'button' : undefined}
            tabIndex={symbol ? 0 : undefined}
            onClick={symbol ? () => onSelectSymbol?.(symbol) : undefined}
            onKeyDown={symbol ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectSymbol?.(symbol);
              }
            } : undefined}
          >
            <div className="flex items-center justify-between">
              <strong>{symbol || row?.catalyst_type || 'Catalyst'}</strong>
              <span style={{ color: toneColor(tone) }}>{String(row?.sentiment || 'neutral')}</span>
            </div>
            <div className="mt-1 text-sm">{row?.headline || 'No headline summary available.'}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(tags.length ? tags : ['Catalyst']).map((tag) => (
                <span key={`${symbol}-${tag}`} className="rounded px-2 py-1 text-xs" style={{ border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}>
                  {tag}
                </span>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
