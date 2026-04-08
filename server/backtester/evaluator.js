const { max, min, toNumber } = require('./utils');

async function evaluateRiskModel(signal, subsequentBars, options = {}) {
  const direction = String(signal.direction || 'long').toLowerCase();
  const entryPrice = toNumber(signal.entryPrice, 0);
  const stopPrice = toNumber(signal.stopPrice, 0);
  const targetPrice = toNumber(signal.targetPrice, 0);
  const maxBars = Math.max(1, Number(options.maxBars) || subsequentBars.length || 1);
  const ignoreTarget = options.ignoreTarget === true;
  const stopFirst = options.stopFirst !== false;
  const bars = (Array.isArray(subsequentBars) ? subsequentBars : []).slice(0, maxBars);

  const riskPerShare = Math.abs(entryPrice - stopPrice);
  let exitPrice = entryPrice;
  let exitReason = 'time_exit';
  let barsHeld = 0;
  let hitStop = false;
  let hitTarget = false;

  const highs = [];
  const lows = [];

  for (const bar of bars) {
    barsHeld += 1;
    const high = toNumber(bar.high, entryPrice);
    const low = toNumber(bar.low, entryPrice);
    const close = toNumber(bar.close, entryPrice);
    highs.push(high);
    lows.push(low);

    if (direction === 'long') {
      const stopTriggered = low <= stopPrice;
      const targetTriggered = !ignoreTarget && high >= targetPrice;
      if (stopFirst && stopTriggered) {
        exitPrice = stopPrice;
        exitReason = 'stop';
        hitStop = true;
        break;
      }
      if (targetTriggered) {
        exitPrice = targetPrice;
        exitReason = 'target';
        hitTarget = true;
        break;
      }
      if (!stopFirst && stopTriggered) {
        exitPrice = stopPrice;
        exitReason = 'stop';
        hitStop = true;
        break;
      }
      exitPrice = close;
    } else {
      const stopTriggered = high >= stopPrice;
      const targetTriggered = !ignoreTarget && low <= targetPrice;
      if (stopFirst && stopTriggered) {
        exitPrice = stopPrice;
        exitReason = 'stop';
        hitStop = true;
        break;
      }
      if (targetTriggered) {
        exitPrice = targetPrice;
        exitReason = 'target';
        hitTarget = true;
        break;
      }
      if (!stopFirst && stopTriggered) {
        exitPrice = stopPrice;
        exitReason = 'stop';
        hitStop = true;
        break;
      }
      exitPrice = close;
    }
  }

  const maxMovePrice = direction === 'long'
    ? max(highs) || entryPrice
    : min(lows) || entryPrice;
  const maxDrawdownPrice = direction === 'long'
    ? min(lows) || entryPrice
    : max(highs) || entryPrice;

  const pnlPercent = direction === 'long'
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - exitPrice) / entryPrice) * 100;
  const pnlR = riskPerShare > 0
    ? (direction === 'long' ? (exitPrice - entryPrice) : (entryPrice - exitPrice)) / riskPerShare
    : 0;
  const maxMovePercent = direction === 'long'
    ? ((maxMovePrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - maxMovePrice) / entryPrice) * 100;
  const maxDrawdownPercent = direction === 'long'
    ? ((maxDrawdownPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - maxDrawdownPrice) / entryPrice) * 100;

  return {
    hit_target: hitTarget,
    hit_stop: hitStop,
    max_move: maxMovePrice,
    max_drawdown: maxDrawdownPrice,
    exit_price: exitPrice,
    exit_reason: exitReason,
    bars_held: barsHeld,
    pnl_percent: pnlPercent,
    pnl_r: pnlR,
    max_move_percent: maxMovePercent,
    max_drawdown_percent: maxDrawdownPercent,
  };
}

module.exports = {
  evaluateRiskModel,
};