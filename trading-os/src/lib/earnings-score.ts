type EarningsScoreInput = {
  expectedMove?: number;
  volume?: number;
  marketCap?: number;
};

export function scoreEarnings(e: EarningsScoreInput): number {
  const move = Math.abs(e.expectedMove || 0);
  const volume = e.volume || 0;
  const marketCap = e.marketCap || 0;

  let score = 0;

  score += move * 5;
  score += volume > 1_000_000 ? 2 : 0;
  score += marketCap > 10_000_000_000 ? 2 : 1;

  return score;
}
