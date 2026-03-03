export type NormalizedTimeframe = '1m' | '3m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W' | 'ALL';

export function normalizeTimeframe(value: string): NormalizedTimeframe {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'all') return 'ALL';
  if (raw === '1w') return '1W';
  if (raw === '1d') return '1D';
  if (raw === '4h') return '4H';
  if (raw === '1h') return '1H';
  if (raw === '15m') return '15m';
  if (raw === '3m') return '3m';
  if (raw === '5m') return '5m';
  return '1m';
}