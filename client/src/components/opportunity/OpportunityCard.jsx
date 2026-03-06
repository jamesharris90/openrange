import { Newspaper, Zap } from 'lucide-react';
import TickerLink from '../shared/TickerLink';

function fmt(num, digits = 1) {
  const parsed = Number(num);
  if (!Number.isFinite(parsed)) return '--';
  return parsed.toFixed(digits);
}

export default function OpportunityCard({ row }) {
  const symbol = String(row?.symbol || '').toUpperCase();
  const strategy = row?.setup_type || row?.setup || row?.event_type || 'Signal';
  const score = row?.score;
  const catalyst = row?.headline || row?.catalyst_headline || row?.source || '--';
  const volume = row?.relative_volume ?? row?.volume_ratio ?? row?.volume;
  const gap = row?.gap_percent ?? row?.change_percent ?? row?.move_percent;

  return (
    <article className="or-card-ui">
      <div className="mb-2 flex items-center justify-between">
        <TickerLink symbol={symbol} />
        <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-0.5 text-xs font-semibold">Score {fmt(score, 1)}</span>
      </div>
      <div className="text-sm font-semibold text-[var(--text-primary)]">{strategy}</div>
      <div className="mt-2 line-clamp-2 text-xs text-[var(--text-muted)]">{catalyst}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-[var(--border-default)] p-2">
          <div className="mb-1 flex items-center gap-1 text-[var(--text-muted)]"><Zap size={12} /> Volume</div>
          <div className="font-semibold">{fmt(volume, 2)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-default)] p-2">
          <div className="mb-1 flex items-center gap-1 text-[var(--text-muted)]"><Newspaper size={12} /> Gap %</div>
          <div className="font-semibold">{fmt(gap, 2)}%</div>
        </div>
      </div>
    </article>
  );
}
