import type { CanonicalQuote } from '../schema/canonical/CanonicalQuote';
import type { CanonicalNewsItem } from '../schema/canonical/CanonicalNewsItem';

export interface QuoteScore {
  liquidityScore: number;
  catalystScore: number;
  technicalScore: number;
  compositeScore: number;
  tier: 'Tier 1' | 'Tier 2' | 'Tier 3';
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function bandScore(value: number, minInput: number, maxInput: number, minScore: number, maxScore: number): number {
  const boundedValue = clamp(value, minInput, maxInput);
  if (maxInput === minInput) return Math.round(minScore);
  const pct = (boundedValue - minInput) / (maxInput - minInput);
  return Math.round(minScore + pct * (maxScore - minScore));
}

function scoreLiquidity(quote: CanonicalQuote): number {
  const rvol = typeof quote.rvol === 'number' && Number.isFinite(quote.rvol)
    ? quote.rvol
    : null;

  if (rvol == null) return 20;
  if (rvol >= 5) return bandScore(rvol, 5, 10, 90, 100);
  if (rvol >= 2) return bandScore(rvol, 2, 5, 70, 89);
  if (rvol >= 1) return bandScore(rvol, 1, 2, 50, 69);
  return bandScore(Math.max(0, rvol), 0, 1, 30, 49);
}

function scoreCatalyst(news?: CanonicalNewsItem[]): number {
  const items = Array.isArray(news) ? news : [];

  const isToday = (iso?: string): boolean => {
    if (!iso) return false;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    return d.toDateString() === new Date().toDateString();
  };

  const hasHighCatalyst = items.some((item) => {
    const source = String(item?.source || '').toLowerCase();
    const headline = String(item?.headline || '').toLowerCase();
    const publishedToday = isToday(item?.publishedAt);

    const isPressRelease = source.includes('press') || headline.includes('press release');
    const isEarningsToday = publishedToday && headline.includes('earnings');

    return isPressRelease || isEarningsToday;
  });

  if (hasHighCatalyst) return 90;
  if (items.length > 0) return 65;
  return 30;
}

export function scoreQuote(input: {
  quote: CanonicalQuote;
  news?: CanonicalNewsItem[];
}): QuoteScore {
  const liquidityScore = scoreLiquidity(input.quote);
  const catalystScore = scoreCatalyst(input.news);
  const technicalScore = 50;

  const compositeScore = Math.round(
    liquidityScore * 0.4 + catalystScore * 0.4 + technicalScore * 0.2
  );

  let tier: 'Tier 1' | 'Tier 2' | 'Tier 3' = 'Tier 3';
  if (compositeScore >= 80) tier = 'Tier 1';
  else if (compositeScore >= 60) tier = 'Tier 2';

  return {
    liquidityScore,
    catalystScore,
    technicalScore,
    compositeScore,
    tier,
  };
}
