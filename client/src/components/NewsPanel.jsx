import React from 'react';

function pickArray(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function normalizeRows(news) {
  const rows = pickArray(news?.data, news?.items, news?.rows, news);
  return rows.slice(0, 5).map((row, index) => ({
    id: row?.id || `${row?.symbol || 'news'}-${index}`,
    title: String(row?.title || row?.headline || 'Untitled headline'),
    source: String(row?.source || row?.provider || 'Unknown source'),
  }));
}

export default function NewsPanel({ news }) {
  const rows = normalizeRows(news);

  return (
    <section className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-[0_8px_24px_rgba(2,6,23,0.25)]">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Key News</h3>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-sm text-slate-400">No news headlines available.</p> : null}
        {rows.map((row) => (
          <article key={row.id} className="rounded-lg border border-slate-700/70 bg-slate-950/70 px-3 py-2">
            <h4 className="text-sm text-slate-100">{row.title}</h4>
            <p className="mt-1 text-xs text-slate-400">{row.source}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
