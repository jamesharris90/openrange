export function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function formatPercent(value, digits = 2) {
  const num = toNumber(value, 0);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(digits)}%`;
}

export function sentimentTone(sentiment) {
  const s = String(sentiment || '').toLowerCase();
  if (s.includes('bull') || s.includes('positive')) return 'bullish';
  if (s.includes('bear') || s.includes('negative')) return 'bearish';
  return 'neutral';
}

export function toneColor(tone) {
  if (tone === 'bullish') return 'var(--accent-green)';
  if (tone === 'bearish') return 'var(--accent-red)';
  return 'var(--text-muted)';
}
