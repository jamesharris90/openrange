function deriveSetup({ bias, structureScore, vwapPosition, rvol }) {
  if (vwapPosition === 'reclaim' && rvol >= 1.5) {
    return 'VWAP_RECLAIM';
  }

  if (structureScore >= 3 && rvol >= 2) {
    return 'MOMENTUM_CONTINUATION';
  }

  if (structureScore >= 2 && rvol >= 1.5) {
    return 'ORB';
  }

  return 'NO_SETUP';
}

function buildExecutionPlan({ price, atr, setup }) {
  if (!price || !atr) return null;

  switch (setup) {
    case 'VWAP_RECLAIM':
      return {
        entry: price,
        stop: price - atr * 0.5,
        target: price + atr,
      };

    case 'MOMENTUM_CONTINUATION':
      return {
        entry: price,
        stop: price - atr,
        target: price + atr * 2,
      };

    case 'ORB':
      return {
        entry: price,
        stop: price - atr,
        target: price + atr * 1.5,
      };

    default:
      return null;
  }
}

module.exports = {
  deriveSetup,
  buildExecutionPlan,
};
