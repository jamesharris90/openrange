import React from 'react';
import type { NewsRow } from '../../hooks/useCockpitData';

type NewsPanelProps = {
  rows: NewsRow[];
  symbol?: string;
};

export default function NewsPanel({ rows, symbol }: NewsPanelProps) {
  const displayRows = rows.slice(0, 15);

  return (
    <div className="h-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {symbol ? `${symbol} Live News` : 'Live News'}
      </div>
      <div className="space-y-2 overflow-auto text-xs" style={{ maxHeight: '100%' }}>
        {displayRows.length === 0 && (
          <div className="text-[var(--text-secondary)]">{symbol ? `No news available for ${symbol}.` : 'No news available.'}</div>
        )}
        {displayRows?.map((row, idx) => (
          <a
            key={`${row.symbol}-${idx}`}
            href={row.url || '#'}
            target="_blank"
            rel="noreferrer"
            className="block rounded border border-[var(--border-color)] bg-[var(--bg-input)] p-2"
          >
            <div className="mb-1 font-semibold text-[var(--text-primary)]">{row.symbol} — {row.headline}</div>
            <div className="line-clamp-2 text-[var(--text-secondary)]">{row.summary}</div>
            <div className="mt-1 text-[10px] text-[var(--text-secondary)]">{row.source} {row.newsScore != null ? `• Score ${row.newsScore}` : ''}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
