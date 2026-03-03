// @ts-nocheck

const ATR_MIN_THRESHOLD = 0.5;
const DOLLAR_VOLUME_MIN = 10_000_000;

const ORB_VOLUME_MULTIPLIER_MIN = 1.35;
const ORB_CANDLE_DOLLAR_VOLUME_MIN = 7_500_000;
const VWAP_RECLAIM_VOLUME_MULTIPLIER_MIN = 1.05;
const VWAP_RETEST_TOLERANCE = 1.005;
const EMA_COMPRESSION_BAND_MAX_PCT = 0.85;
const EMA_BREAKOUT_RANGE_MULTIPLIER_MIN = 0.75;
const SWEEP_VOLUME_SPIKE_MULTIPLIER_MIN = 1.75;

function last(arr, n = 1) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[arr.length - n] ?? null;
}

function toMap(series) {
  return new Map((Array.isArray(series) ? series : []).map((p) => [p.time, p.value]));
}

function average(values) {
  const valid = (values || []).filter((v) => Number.isFinite(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function latestValue(series) {
  const point = last(series);
  const value = Number(point?.value);
  return Number.isFinite(value) ? value : null;
}

function hasIndicatorSeries(context, key) {
  return Array.isArray(context?.indicators?.[key]) && context.indicators[key].length > 0;
}

function toCheck(rule, passed, value) {
  return {
    rule,
    passed: Boolean(passed),
    value: value == null ? null : value,
  };
}

function buildResult(type, confidence, signals, invalidations, timestamp, liquidityQualified, volatilityQualified, extra = {}) {
  const safeConfidence = clamp(Number.isFinite(confidence) ? confidence : 0, 0, 100);
  return {
    type,
    structure: type,
    confidence: safeConfidence,
    signals: Array.isArray(signals) ? signals.filter(Boolean) : [],
    invalidations: Array.isArray(invalidations) ? invalidations.filter(Boolean) : [],
    liquidityQualified: Boolean(liquidityQualified),
    volatilityQualified: Boolean(volatilityQualified),
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    time: Number.isFinite(timestamp) ? timestamp : null,
    ...extra,
  };
}

function isStrongSpyAlignment(context) {
  if (context?.spyAlignment === true) return true;
  if (typeof context?.spyAlignmentScore === 'number') return context.spyAlignmentScore >= 0.7;
  if (context?.spy?.alignment === true) return true;
  return false;
}

function evaluateInvariants(context) {
  const checks = [];

  const intraday = Array.isArray(context?.intradayCandles) ? context.intradayCandles : [];
  const daily = Array.isArray(context?.dailyCandles) ? context.dailyCandles : [];

  const atrPercent = latestValue(context?.indicators?.atrPercent);
  const dollarVolume = Number(context?.metrics?.dollarVolume);
  const hasHistory = intraday.length >= 20 && daily.length >= 2;
  const hasRequiredIndicators = [
    'vwap',
    'rsi14',
    'ema9',
    'ema20',
    'ema50',
    'atrPercent',
  ].every((key) => hasIndicatorSeries(context, key));

  const liquidityQualified = Number.isFinite(dollarVolume) && dollarVolume >= DOLLAR_VOLUME_MIN;
  const volatilityQualified = Number.isFinite(atrPercent) && atrPercent >= ATR_MIN_THRESHOLD;

  checks.push(toCheck(`Dollar volume >= ${DOLLAR_VOLUME_MIN}`, liquidityQualified, dollarVolume));
  checks.push(toCheck(`ATR% >= ${ATR_MIN_THRESHOLD}`, volatilityQualified, atrPercent));
  checks.push(toCheck('Price history available', hasHistory, { intraday: intraday.length, daily: daily.length }));
  checks.push(toCheck('Indicator fields available', hasRequiredIndicators));

  return {
    checks,
    liquidityQualified,
    volatilityQualified,
    canDetect: liquidityQualified && volatilityQualified && hasHistory && hasRequiredIndicators,
  };
}

function detectORB(context) {
  const intraday = context.intradayCandles || [];
  if (intraday.length < 15) return { result: null, checks: [] };

  const opening = intraday.slice(0, 3);
  const rangeHigh = Math.max(...opening.map((c) => c.high));
  const rangeLow = Math.min(...opening.map((c) => c.low));
  const orbWindowEnd = Math.min(intraday.length, 15);
  const atrPercent = latestValue(context?.indicators?.atrPercent);
  const relVol = Number(context?.metrics?.relativeVolume);
  const spyAligned = isStrongSpyAlignment(context);

  for (let i = 3; i < orbWindowEnd; i++) {
    const candle = intraday[i];
    const prev = intraday.slice(Math.max(0, i - 5), i);
    const avgPrevVol = average(prev.map((c) => c.volume)) ?? null;
    const volMultiplier = Number.isFinite(avgPrevVol) && avgPrevVol > 0 ? candle.volume / avgPrevVol : null;
    const breakout = Number.isFinite(candle.close) && Number.isFinite(rangeHigh) && candle.close > rangeHigh;
    const volumeQualified = Number.isFinite(volMultiplier) && volMultiplier >= ORB_VOLUME_MULTIPLIER_MIN;
    const candleDollarVolume = Number.isFinite(candle.close) && Number.isFinite(candle.volume) ? candle.close * candle.volume : null;
    const dollarQualified = Number.isFinite(candleDollarVolume) && candleDollarVolume >= ORB_CANDLE_DOLLAR_VOLUME_MIN;

    const checks = [
      toCheck('Within first 15 minutes', i < 15, i),
      toCheck('Break above ORH', breakout, { close: candle.close, rangeHigh }),
      toCheck(`Volume >= ${ORB_VOLUME_MULTIPLIER_MIN}x avg 5-min volume`, volumeQualified, volMultiplier),
      toCheck(`Dollar volume >= ${ORB_CANDLE_DOLLAR_VOLUME_MIN}`, dollarQualified, candleDollarVolume),
    ];

    if (!checks.every((check) => check.passed)) continue;

    const confidence = clamp(
      50
      + (Number.isFinite(relVol) && relVol > 1.5 ? 10 : 0)
      + (Number.isFinite(atrPercent) && atrPercent > 2 ? 10 : 0)
      + (spyAligned ? 10 : 0),
      0,
      100
    );

    return {
      checks,
      result: buildResult(
        'ORB',
        confidence,
        ['Break ORH', 'High RVOL', 'Strong Volume'],
        ['Falls below ORH', 'Volume collapses below breakout average'],
        candle.time,
        true,
        true,
        {
          invalidationLevel: rangeLow,
          direction: 'continuation',
          color: 'green',
          primaryRulesPassed: checks.every((check) => check.passed),
        }
      ),
    };
  }

  return { result: null, checks: [] };
}

function detectVwapReclaim(context) {
  const intraday = context.intradayCandles || [];
  if (intraday.length < 8) return { result: null, checks: [] };

  const vwapMap = toMap(context.indicators.vwap);
  const relVol = Number(context?.metrics?.relativeVolume);
  const e9 = latestValue(context.indicators.ema9);
  const e20 = latestValue(context.indicators.ema20);

  for (let i = 2; i < intraday.length - 1; i++) {
    const prev = intraday[i - 1];
    const candle = intraday[i];
    const next = intraday[i + 1];

    const prevVwap = vwapMap.get(prev.time);
    const reclaimVwap = vwapMap.get(candle.time);
    const nextVwap = vwapMap.get(next.time);

    const priorCloseBelow = Number.isFinite(prevVwap) && prev.close < prevVwap;
    const closeAbove = Number.isFinite(reclaimVwap) && candle.close > reclaimVwap;
    const retestHolds = Number.isFinite(nextVwap) && next.low <= nextVwap * VWAP_RETEST_TOLERANCE && next.close >= nextVwap;
    const avgPrevVol = average(intraday.slice(Math.max(0, i - 5), i).map((c) => c.volume)) ?? null;
    const volumeExpansion = Number.isFinite(avgPrevVol) && avgPrevVol > 0 && candle.volume >= avgPrevVol * VWAP_RECLAIM_VOLUME_MULTIPLIER_MIN;

    const checks = [
      toCheck('Prior close below VWAP', priorCloseBelow),
      toCheck('Close above VWAP', closeAbove),
      toCheck(`Retest holds within ${(VWAP_RETEST_TOLERANCE - 1) * 100}% tolerance`, retestHolds),
      toCheck('Volume expansion on reclaim', volumeExpansion),
    ];

    if (!checks.every((check) => check.passed)) continue;

    const cleanRejectionWick = Number.isFinite(candle.low) && Number.isFinite(reclaimVwap) && candle.low <= reclaimVwap && candle.close > reclaimVwap;
    const emaAlignment = Number.isFinite(e9) && Number.isFinite(e20) && e9 >= e20;

    const confidence = clamp(
      55
      + (cleanRejectionWick ? 10 : 0)
      + (emaAlignment ? 10 : 0)
      + (Number.isFinite(relVol) && relVol > 1.2 ? 10 : 0)
      + (volumeExpansion ? 10 : 0),
      0,
      100
    );

    return {
      checks,
      result: buildResult(
        'VWAPReclaim',
        confidence,
        ['Prior close below VWAP', 'Close reclaimed VWAP', 'Retest held'],
        ['Closes back below VWAP', 'Retest fails with expanding sell volume'],
        candle.time,
        true,
        true,
        {
          invalidationLevel: Math.min(prev.low, candle.low, next.low),
          direction: 'reclaim',
          color: 'blue',
          primaryRulesPassed: checks.every((check) => check.passed),
        }
      ),
    };
  }

  return { result: null, checks: [] };
}

function detectEmaCompression(context) {
  const candles = context.intradayCandles || [];
  if (candles.length < 10) return { result: null, checks: [] };

  const e9 = latestValue(context.indicators.ema9);
  const e20 = latestValue(context.indicators.ema20);
  const e50 = latestValue(context.indicators.ema50);
  const atrPct = latestValue(context.indicators.atrPercent);
  const lastCandle = last(candles);
  const prior5 = candles.slice(-6, -1);
  const priorRangeAvg = average(prior5.map((c) => Number(c.high) - Number(c.low)));
  const breakoutRange = Number(lastCandle?.high) - Number(lastCandle?.low);

  const validEmas = [e9, e20, e50].every(Number.isFinite);
  const maxE = validEmas ? Math.max(e9, e20, e50) : null;
  const minE = validEmas ? Math.min(e9, e20, e50) : null;
  const compressionPct = Number.isFinite(maxE) && Number.isFinite(minE) && maxE > 0
    ? ((maxE - minE) / maxE) * 100
    : null;

  const checks = [
    toCheck(`EMA9/20/50 within ${EMA_COMPRESSION_BAND_MAX_PCT}% band`, Number.isFinite(compressionPct) && compressionPct <= EMA_COMPRESSION_BAND_MAX_PCT, compressionPct),
    toCheck('ATR% < 3', Number.isFinite(atrPct) && atrPct < 3, atrPct),
    toCheck(`Breakout range >= ${EMA_BREAKOUT_RANGE_MULTIPLIER_MIN}x prior 5-candle avg`, Number.isFinite(breakoutRange) && Number.isFinite(priorRangeAvg) && breakoutRange >= priorRangeAvg * EMA_BREAKOUT_RANGE_MULTIPLIER_MIN, {
      breakoutRange,
      priorRangeAvg,
    }),
  ];

  if (!checks.every((check) => check.passed)) return { result: null, checks };

  const confidence = clamp(
    55
    + (compressionPct <= 0.3 ? 15 : 8)
    + (Number.isFinite(atrPct) && atrPct < 2 ? 10 : 5)
    + (breakoutRange > priorRangeAvg * 1.25 ? 10 : 5),
    0,
    100
  );

  return {
    checks,
    result: buildResult(
      'EMACompression',
      confidence,
      ['EMA band compressed', 'Controlled ATR', 'Expansion breakout candle'],
      ['EMA spread widens above 0.5%', 'Breakout fails and closes back in compression band'],
      lastCandle?.time,
      true,
      true,
      {
        invalidationLevel: Math.min(...candles.slice(-6).map((c) => c.low)),
        direction: 'compression',
        color: 'orange',
        primaryRulesPassed: checks.every((check) => check.passed),
      }
    ),
  };
}

function detectLiquiditySweep(context) {
  const intraday = context.intradayCandles || [];
  if (intraday.length < 12) return { result: null, checks: [] };

  for (let i = 6; i < intraday.length; i++) {
    const c = intraday[i];
    const priorWindow = intraday.slice(Math.max(0, i - 6), i);
    const priorHigh = Math.max(...priorWindow.map((x) => x.high));
    const priorLow = Math.min(...priorWindow.map((x) => x.low));

    const brokePriorHigh = c.high > priorHigh;
    const brokePriorLow = c.low < priorLow;
    const immediateReversal = (brokePriorHigh && c.close < priorHigh) || (brokePriorLow && c.close > priorLow);
    const localAvgVol = average(priorWindow.map((x) => x.volume)) ?? null;
    const volumeSpike = Number.isFinite(localAvgVol) && localAvgVol > 0 && c.volume >= localAvgVol * SWEEP_VOLUME_SPIKE_MULTIPLIER_MIN;

    const checks = [
      toCheck('Break prior high/low', brokePriorHigh || brokePriorLow),
      toCheck('Immediate reversal', immediateReversal),
      toCheck(`Volume spike >= ${SWEEP_VOLUME_SPIKE_MULTIPLIER_MIN}x local avg`, volumeSpike),
    ];

    if (!checks.every((check) => check.passed)) continue;

    const confidence = clamp(60 + (volumeSpike ? 20 : 0) + (immediateReversal ? 10 : 0), 0, 100);

    return {
      checks,
      result: buildResult(
        'LiquiditySweep',
        confidence,
        ['Swept prior liquidity pool', 'Immediate reversal', 'Volume spike confirmed'],
        ['Price closes beyond sweep extremity', 'Volume dries up post-sweep'],
        c.time,
        true,
        true,
        {
          invalidationLevel: brokePriorHigh ? c.high : c.low,
          direction: immediateReversal ? 'reversal' : 'continuation',
          color: immediateReversal ? 'red' : 'green',
          primaryRulesPassed: checks.every((check) => check.passed),
        }
      ),
    };
  }

  return { result: null, checks: [] };
}

function computeSubscores(context, primary) {
  const atrPct = latestValue(context.indicators.atrPercent);
  const ema20 = latestValue(context.indicators.ema20);
  const ema50 = latestValue(context.indicators.ema50);
  const close = last(context.candles)?.close;
  const relVol = context.metrics?.relativeVolume;

  const structureScore = Number.isFinite(primary?.confidence) ? primary.confidence : 0;
  const volumeScore = Number.isFinite(relVol) ? clamp(relVol * 25, 0, 100) : 0;
  const volatilityScore = Number.isFinite(atrPct) ? clamp(atrPct * 8, 0, 100) : 0;
  const trendScore = (Number.isFinite(close) && Number.isFinite(ema20) && Number.isFinite(ema50))
    ? clamp((close > ema20 ? 40 : 15) + (ema20 > ema50 ? 40 : 15) + 20, 0, 100)
    : 0;

  return { structureScore, volumeScore, volatilityScore, trendScore };
}

function detectStructure(context, options = {}) {
  const trace = options?.trace === true;
  const invariant = evaluateInvariants(context);
  const checks = [...invariant.checks];

  if (!invariant.canDetect) {
    const empty = {
      result: null,
      structures: [],
      primaryStructure: null,
      score: 0,
      invalidation: null,
      structureScore: 0,
      volumeScore: 0,
      volatilityScore: 0,
      trendScore: 0,
    };
    return trace ? { ...empty, checks } : empty;
  }

  const detectors = [detectORB, detectVwapReclaim, detectEmaCompression, detectLiquiditySweep];
  const detectionRuns = detectors.map((fn) => fn(context)).filter(Boolean);

  for (const run of detectionRuns) {
    if (Array.isArray(run?.checks) && run.checks.length) checks.push(...run.checks);
  }

  const structures = detectionRuns
    .map((run) => run?.result)
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence);

  const primary = structures[0] || null;
  const subscores = computeSubscores(context, primary);

  const payload = {
    structures,
    primaryStructure: primary?.type || null,
    score: primary?.confidence ?? 0,
    invalidation: primary?.invalidationLevel ?? null,
    ...subscores,
  };

  if (trace) return { ...payload, result: primary, checks };
  return { ...payload, result: primary };
}

function detectStructures(context, options = {}) {
  return detectStructure(context, options);
}

module.exports = {
  detectStructure,
  detectStructures,
};
