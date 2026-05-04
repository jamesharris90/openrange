function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const CRITICAL_RISK_FLAGS = new Set(['offering_in_24h', 'fading_from_high', 'sector_strongly_against']);

function hasCriticalRisk(riskFlags = []) {
  return (riskFlags || []).some((flag) => CRITICAL_RISK_FLAGS.has(flag));
}

function classifyLabel({ score = 0, components = {}, metrics = {}, riskFlags = [] }) {
  const compositeScore = toNumber(score) || 0;
  const catalystScore = toNumber(components.catalystScore) || 0;
  const volumeScore = toNumber(components.volumeScore) || 0;
  const structureScore = toNumber(components.structureScore) || 0;
  const hasCritical = hasCriticalRisk(riskFlags);

  const strongComponents = [catalystScore, volumeScore, structureScore].filter((value) => value >= 50).length;
  const meetsA = compositeScore >= 70
    && catalystScore >= 70
    && volumeScore >= 50
    && structureScore >= 70
    && !hasCritical;

  if (meetsA) {
    return 'A';
  }

  const meetsB = compositeScore >= 40 && strongComponents >= 2 && !hasCritical;
  if (meetsB) {
    return 'B';
  }

  return 'C';
}

function generateRiskFlags({ metrics = {}, context = {}, secFilings = [], news = [], marketContext = {} }) {
  const riskFlags = new Set();

  const gapPercent = Math.abs(toNumber(metrics.gapPercent) || 0);
  if (gapPercent > 25) riskFlags.add('gap_too_extended');

  const currentPrice = toNumber(metrics.currentPrice);
  const premarketHigh = toNumber(metrics.premarketHigh);
  if (currentPrice !== null && premarketHigh !== null && currentPrice < premarketHigh * 0.98) {
    riskFlags.add('fading_from_high');
  }

  if ((toNumber(metrics.premarketVolume) || 0) < 50000) {
    riskFlags.add('low_premarket_volume');
  }

  const sectorRank = toNumber(metrics.sectorRank);
  const totalSectors = Object.keys(marketContext?.sectors || {}).length || 0;
  if (sectorRank !== null && totalSectors >= 2 && sectorRank >= (totalSectors - 1)) {
    riskFlags.add('sector_strongly_against');
  }

  if ((toNumber(metrics.catalystScore) || 0) < 30) {
    riskFlags.add('no_catalyst');
  }

  if ((secFilings || []).some((filing) => {
    const formType = String(filing?.form_type || filing?.formType || '').toUpperCase();
    return /^424B/.test(formType) || formType === 'S-1' || formType === 'S-1/A' || filing?.is_offering === true;
  })) {
    riskFlags.add('offering_in_24h');
  }

  if ((toNumber(metrics.floatShares) || 0) > 0 && (toNumber(metrics.floatShares) || 0) < 5000000) {
    riskFlags.add('low_float');
  }

  if ((toNumber(metrics.marketCap) || 0) > 0 && (toNumber(metrics.marketCap) || 0) < 100000000) {
    riskFlags.add('micro_market_cap');
  }

  if ((toNumber(metrics.baselineDays) || 0) > 0 && (toNumber(metrics.baselineDays) || 0) < 10) {
    riskFlags.add('insufficient_baseline');
  }

  return Array.from(riskFlags);
}

function deriveStructureType({ components = {}, metrics = {} }) {
  const catalystScore = toNumber(components.catalystScore) || 0;
  const volumeScore = toNumber(components.volumeScore) || 0;
  const gapScore = toNumber(components.gapScore) || 0;
  const aboveVwap = Boolean(metrics.aboveVwap);
  const nearHigh = Boolean(metrics.nearHigh);
  const lateVolumeShare = toNumber(metrics.last15VolumeShare) || 0;

  if (catalystScore >= 70 && gapScore >= 60 && aboveVwap && nearHigh) {
    return 'Catalyst Gap & Hold';
  }

  if (catalystScore >= 70 && gapScore >= 60 && !aboveVwap) {
    return 'Catalyst Gap & Fade';
  }

  if (volumeScore >= 70 && catalystScore < 40) {
    return 'High Volume No Catalyst';
  }

  if (volumeScore >= 50 && lateVolumeShare >= 0.4) {
    return 'Late Premarket Ignition';
  }

  if (catalystScore >= 40 || volumeScore >= 40 || aboveVwap) {
    return 'Mixed Signals';
  }

  return 'Weak Setup';
}

function deriveTradeState({ label, structureType, metrics = {} }) {
  if (label === 'A' && (structureType === 'Catalyst Gap & Hold' || structureType === 'Late Premarket Ignition')) {
    return 'watch_for_orb';
  }

  if (label === 'A' || label === 'B') {
    return 'monitor';
  }

  return 'skip';
}

function generateWhy({ components = {}, metrics = {}, context = {}, structureType }) {
  const reasons = [];

  if ((toNumber(components.catalystScore) || 0) >= 70 && context?.catalyst?.summary) {
    reasons.push(`Catalyst: ${context.catalyst.summary}`);
  }

  if ((toNumber(metrics.gapPercent) || 0) !== 0) {
    reasons.push(`Gap ${Number(metrics.gapPercent).toFixed(2)}% versus previous close`);
  }

  if ((toNumber(metrics.rvol) || 0) >= 1) {
    reasons.push(`Premarket RVOL ${Number(metrics.rvol).toFixed(2)}x versus baseline`);
  }

  if (metrics.aboveVwap) {
    reasons.push('Trading above premarket VWAP');
  }

  if (metrics.nearHigh) {
    reasons.push('Holding near premarket high');
  }

  if (structureType) {
    reasons.push(`Structure: ${structureType}`);
  }

  if (context?.marketRegime) {
    reasons.push(`Market regime ${context.marketRegime}`);
  }

  return reasons.filter(Boolean).slice(0, 5);
}

module.exports = {
  CRITICAL_RISK_FLAGS,
  classifyLabel,
  generateRiskFlags,
  deriveStructureType,
  deriveTradeState,
  generateWhy,
};
