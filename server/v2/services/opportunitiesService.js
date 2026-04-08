const { getScreenerRows } = require('./screenerService');
const { buildNarrative } = require('./narrativeService');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function getNewsRecencyScore(publishedAt) {
  const parsed = Date.parse(String(publishedAt || ''));
  if (Number.isNaN(parsed)) {
    return 0;
  }

  const ageHours = Math.max(0, (Date.now() - parsed) / 3600000);
  if (ageHours <= 1) return 1;
  if (ageHours <= 6) return 0.85;
  if (ageHours <= 24) return 0.65;
  if (ageHours <= 72) return 0.35;
  return 0;
}

function getEarningsProximityScore(earningsDate) {
  if (!earningsDate) {
    return 0;
  }

  const parsed = Date.parse(`${earningsDate}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return 0;
  }

  const dayDiff = Math.abs(Math.round((parsed - Date.now()) / 86400000));
  if (dayDiff <= 1) return 1;
  if (dayDiff <= 3) return 0.8;
  if (dayDiff <= 7) return 0.5;
  return 0;
}

function getRvolStrength(rvol) {
  const value = toNumber(rvol, 0);
  if (value >= 5) return 1;
  if (value >= 4) return 0.9;
  if (value >= 3) return 0.8;
  if (value >= 2.25) return 0.68;
  if (value >= 1.5) return 0.55;
  return 0;
}

function getMoveStrength(changePercent) {
  const value = Math.abs(toNumber(changePercent, 0));
  if (value >= 30) return 1;
  if (value >= 20) return 0.9;
  if (value >= 12) return 0.78;
  if (value >= 8) return 0.68;
  if (value >= 5) return 0.58;
  if (value >= 3) return 0.46;
  return 0;
}

function getCatalystDescriptor(row, components) {
  if (components.newsRecency >= 0.65) {
    return 'fresh news catalyst';
  }

  if (components.newsRecency > 0) {
    return 'recent news catalyst';
  }

  if (components.earningsProximity >= 0.8) {
    return 'near-term earnings catalyst';
  }

  if (String(row.driver_type || '').toUpperCase() === 'MACRO') {
    return 'macro catalyst';
  }

  return 'tape catalyst';
}

function hasRequiredCatalyst(row, components) {
  return components.newsRecency > 0
    || components.earningsProximity > 0
    || String(row.driver_type || '').toUpperCase() === 'MACRO';
}

function getStructure(row, narrative, components) {
  const absMove = Math.abs(toNumber(row.change_percent, 0));
  const setupType = String(narrative.setup_type || '').trim();

  if (absMove > 30) {
    return null;
  }

  if (narrative.bias === 'reversal' || setupType === 'fade' || setupType === 'mean reversion') {
    return absMove >= 8 || components.rvolStrength >= 0.8 ? 'extension' : 'range';
  }

  if (components.rvolStrength >= 0.8 && components.moveStrength >= 0.58) {
    return 'trend';
  }

  if (components.rvolStrength >= 0.55 && components.moveStrength >= 0.46) {
    return 'range';
  }

  return null;
}

function getSetupType(row, narrative, structure, components) {
  const absMove = Math.abs(toNumber(row.change_percent, 0));
  const narrativeSetup = String(narrative.setup_type || '').trim();

  if (!narrative.tradeable || narrative.bias === 'chop' || narrativeSetup === 'chop / avoid') {
    return null;
  }

  if (narrative.bias === 'reversal' || narrativeSetup === 'fade' || narrativeSetup === 'mean reversion') {
    return structure === 'extension' || absMove >= 10 ? 'fade' : 'mean reversion';
  }

  if (structure === 'trend' && components.rvolStrength >= 0.8 && components.moveStrength >= 0.58) {
    return 'breakout';
  }

  if (structure === 'range' || structure === 'trend') {
    return 'momentum continuation';
  }

  return null;
}

function getTimeframe(setupType, components) {
  if ((setupType === 'mean reversion' || setupType === 'fade') && components.earningsProximity >= 0.8 && components.newsRecency === 0) {
    return 'swing';
  }

  if (setupType === 'momentum continuation' && components.earningsProximity >= 0.8 && components.newsRecency < 0.65) {
    return 'swing';
  }

  return 'intraday';
}

function buildExecutionPlan(row, setupType, structure, components) {
  const direction = toNumber(row.change_percent, 0) >= 0 ? 'up' : 'down';
  const timeframe = getTimeframe(setupType, components);

  if (setupType === 'breakout') {
    return {
      entry_type: 'breakout',
      entry_trigger: 'break above intraday high with volume expansion',
      invalidation: 'lose VWAP or fail back into range',
      timeframe: 'intraday',
      structure: 'trend',
    };
  }

  if (setupType === 'momentum continuation') {
    return {
      entry_type: 'pullback',
      entry_trigger: 'hold above VWAP and form higher low',
      invalidation: 'lose VWAP with volume',
      timeframe,
      structure,
    };
  }

  return {
    entry_type: 'reversal',
    entry_trigger: direction === 'up'
      ? 'reject intraday high and lose VWAP after extension'
      : 'reclaim VWAP after washout and hold above the intraday low',
    invalidation: direction === 'up'
      ? 'reclaim intraday high with volume'
      : 'fail back below VWAP or lose the reclaim low',
    timeframe,
    structure,
  };
}

function getDynamicConfidence(components) {
  const weighted = (
    (components.rvolStrength * 0.35)
    + (components.moveStrength * 0.25)
    + (components.newsRecency * 0.2)
    + (components.earningsProximity * 0.2)
  );

  return Number(clamp(0.55 + (weighted * 0.4), 0.55, 0.95).toFixed(2));
}

function scoreOpportunity(components, confidence) {
  const score = (
    (confidence * 55)
    + (components.rvolStrength * 20)
    + (components.moveStrength * 15)
    + (Math.max(components.newsRecency, components.earningsProximity) * 10)
  );

  return Number(clamp(score, 0, 100).toFixed(2));
}

function buildOpportunityWhy(row, setupType, structure, components) {
  const absMove = Math.abs(toNumber(row.change_percent, 0));
  const catalyst = getCatalystDescriptor(row, components);
  const rvolValue = toNumber(row.rvol, 0).toFixed(1);

  return `${setupType} with ${rvolValue}x RVOL, ${absMove.toFixed(1)}% expansion, and ${catalyst} in ${structure} structure`;
}

function buildConfidenceReason(row, components, confidence) {
  const parts = [
    `${toNumber(row.rvol, 0).toFixed(1)}x RVOL`,
    `${Math.abs(toNumber(row.change_percent, 0)).toFixed(1)}% move`,
  ];

  if (components.newsRecency >= 0.65) {
    parts.push('fresh news inside 24h');
  } else if (components.newsRecency > 0) {
    parts.push('news catalyst still active');
  }

  if (components.earningsProximity >= 0.8) {
    parts.push('earnings catalyst inside 3d');
  } else if (components.earningsProximity > 0) {
    parts.push('earnings event on deck');
  }

  parts.push(`confidence ${confidence.toFixed(2)}`);
  return parts.join(' • ');
}

function hasExecutionPlan(row) {
  return Boolean(
    row
    && row.setup_type
    && row.entry_type
    && row.entry_trigger
    && row.invalidation
    && row.timeframe
    && row.structure
  );
}

function getExecutionSignature(row) {
  return [
    row.setup_type,
    row.entry_type,
    row.entry_trigger,
    row.invalidation,
    row.timeframe,
    row.structure,
  ].join('|');
}

function buildValidationReport(rows, removedWeakSetups) {
  const executionSignatures = rows.map(getExecutionSignature);
  const uniqueSignatureCount = new Set(executionSignatures).size;
  const avgConfidence = Number(average(rows.map((row) => row.confidence)).toFixed(2));
  const executionReady = rows.length > 0 && rows.every(hasExecutionPlan);
  const valid = rows.length < 5 && executionReady && uniqueSignatureCount === rows.length;

  return {
    valid,
    avg_confidence: avgConfidence,
    removed_weak_setups: removedWeakSetups,
    execution_ready: executionReady,
  };
}

async function buildOpportunitiesPayload(input = {}) {
  const hasRows = Array.isArray(input.rows);
  const screenerResult = hasRows ? null : await getScreenerRows();
  const rows = hasRows ? input.rows : screenerResult.rows;
  const macroContext = input.macroContext ?? screenerResult?.macroContext ?? null;
  const candidates = (rows || []).filter(
    (row) => row?.symbol && (row.state === 'FORMING' || row.state === 'CONFIRMED')
  );

  const enriched = [];
  let removedWeakSetups = 0;

  for (const row of candidates) {
    if (toNumber(row.data_confidence, 0) < 60) {
      removedWeakSetups += 1;
      continue;
    }

    const components = {
      rvolStrength: getRvolStrength(row.rvol),
      moveStrength: getMoveStrength(row.change_percent),
      newsRecency: getNewsRecencyScore(row.latest_news_at),
      earningsProximity: getEarningsProximityScore(row.earnings_date),
    };

    if (!hasRequiredCatalyst(row, components)) {
      removedWeakSetups += 1;
      continue;
    }

    if (Math.abs(toNumber(row.change_percent, 0)) > 30) {
      removedWeakSetups += 1;
      continue;
    }

    const narrative = await buildNarrative(row.symbol, row);
    if (!narrative.tradeable || narrative.bias === 'chop' || String(narrative.setup_type || '') === 'chop / avoid') {
      removedWeakSetups += 1;
      continue;
    }

    const structure = getStructure(row, narrative, components);
    if (!structure) {
      removedWeakSetups += 1;
      continue;
    }

    const setupType = getSetupType(row, narrative, structure, components);
    if (!setupType) {
      removedWeakSetups += 1;
      continue;
    }

    const executionPlan = buildExecutionPlan(row, setupType, structure, components);
    const confidence = getDynamicConfidence(components);
    if (confidence < 0.68) {
      removedWeakSetups += 1;
      continue;
    }

    enriched.push({
      symbol: row.symbol,
      score: scoreOpportunity(components, confidence),
      why: buildOpportunityWhy(row, setupType, executionPlan.structure, components),
      state: row.state,
      early_signal: Boolean(row.early_signal),
      bias: narrative.bias,
      risk: narrative.risk,
      confidence_reason: buildConfidenceReason(row, components, confidence),
      setup_type: setupType,
      watch: executionPlan.entry_trigger,
      confidence,
      tradeable: Boolean(row.tradeable),
      data_confidence: toNumber(row.data_confidence, 0),
      final_score: toNumber(row.final_score, 0),
      entry_type: executionPlan.entry_type,
      entry_trigger: executionPlan.entry_trigger,
      invalidation: executionPlan.invalidation,
      timeframe: executionPlan.timeframe,
      structure: executionPlan.structure,
    });
  }

  const deduped = [];
  const executionSignatures = new Set();

  for (const row of enriched
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      return String(left.symbol).localeCompare(String(right.symbol));
    })) {
    const signature = getExecutionSignature(row);
    if (executionSignatures.has(signature)) {
      removedWeakSetups += 1;
      continue;
    }

    executionSignatures.add(signature);
    deduped.push(row);
    if (deduped.length === 4) {
      break;
    }
  }

  return {
    rows: deduped,
    report: buildValidationReport(deduped, removedWeakSetups),
    macroContext,
  };
}

async function getOpportunitiesPayload() {
  return buildOpportunitiesPayload();
}

async function getOpportunityRows() {
  const payload = await getOpportunitiesPayload();
  return payload.rows;
}

module.exports = {
  buildOpportunitiesPayload,
  getOpportunitiesPayload,
  getOpportunityRows,
};