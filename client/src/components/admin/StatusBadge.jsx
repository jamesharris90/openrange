import { memo } from 'react';

function toneClasses(tone) {
  if (tone === 'healthy' || tone === 'ok' || tone === 'online') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  }

  if (tone === 'warning' || tone === 'degraded' || tone === 'stale') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  }

  if (tone === 'error' || tone === 'offline' || tone === 'failed') {
    return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  }

  return 'border-slate-700 bg-slate-800 text-slate-200';
}

function normalize(value) {
  return String(value || 'unknown').toLowerCase();
}

function StatusBadge({ status, label, className = '' }) {
  const normalized = normalize(status || label);
  const text = label || String(status || 'unknown').toUpperCase();

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses(normalized)} ${className}`}
    >
      {text}
    </span>
  );
}

export default memo(StatusBadge);
