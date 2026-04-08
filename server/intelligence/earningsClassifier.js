function classifyEarningsTrade(row) {
  const {
    price,
    rvol,
    expected_move_percent,
    atr,
    market_cap,
    implied_volatility,
    catalyst_strength,
    time,
  } = row || {};

  void atr;
  void catalyst_strength;
  void time;

  if (!price || !expected_move_percent) {
    return {
      classification: 'UNTRADEABLE',
      reason: 'Missing critical fields',
    };
  }

  const move = Number(expected_move_percent) || 0;
  const volume = Number(rvol) || 0;
  const vol = Number(implied_volatility) || 0;
  const cap = Number(market_cap) || 0;

  void vol;

  if (
    move >= 4 &&
    volume >= 1.5 &&
    cap > 0 &&
    cap < 20000000000
  ) {
    return {
      classification: 'A',
      setup: 'Momentum Breakout',
      confidence: 'HIGH',
      reason: 'High expected move + strong participation + mid/low cap',
    };
  }

  if (
    move >= 2 &&
    volume >= 1.2
  ) {
    return {
      classification: 'B',
      setup: 'Continuation / VWAP',
      confidence: 'MEDIUM',
      reason: 'Moderate move + acceptable volume',
    };
  }

  return {
    classification: 'C',
    setup: 'Low Conviction',
    confidence: 'LOW',
    reason: 'Insufficient move or volume',
  };
}

function buildExecutionPlan(row, classification) {
  const price = row?.price;
  const move = row?.expected_move_percent;
  const vwap = row?.vwap;

  void price;
  void move;
  void vwap;

  if (classification === 'A') {
    return 'Break of pre-market high OR VWAP reclaim with volume expansion';
  }

  if (classification === 'B') {
    return 'VWAP reclaim or pullback continuation';
  }

  return 'Avoid or wait for confirmation';
}

function deriveBias(row) {
  const catalystStrength = Number(row?.catalyst_strength);

  if (Number.isFinite(catalystStrength) && catalystStrength >= 0.7) return 'BULLISH';
  if (Number.isFinite(catalystStrength) && catalystStrength <= -0.7) return 'BEARISH';

  return 'NEUTRAL';
}

module.exports = {
  classifyEarningsTrade,
  buildExecutionPlan,
  deriveBias,
};
