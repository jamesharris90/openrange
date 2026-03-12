import RadarCard from './RadarCard';

export default function RadarSection({ title, items = [] }) {
  const safeItems = Array.isArray(items) ? items : [];

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-base">{title}</h3>
        <span className="text-xs text-[var(--text-muted)]">{safeItems.length}</span>
      </div>

      {safeItems.length === 0 ? (
        <div className="text-sm text-[var(--text-muted)]">No signals detected</div>
      ) : (
        <div className="grid gap-2">
          {safeItems.map((item, idx) => (
            <RadarCard
              key={`${String(item?.symbol || 'row')}-${idx}`}
              item={item}
            />
          ))}
        </div>
      )}
    </section>
  );
}
