function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function average(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeReportTime(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return null;
  if (["AM", "BMO", "BEFORE OPEN", "BEFORE MARKET OPEN"].includes(text)) return "AM";
  if (["PM", "AMC", "AFTER CLOSE", "AFTER MARKET CLOSE"].includes(text)) return "PM";
  if (text.includes("BMO") || text.includes("BEFORE")) return "AM";
  if (text.includes("AMC") || text.includes("AFTER")) return "PM";
  return null;
}

function getTrueReactionWindow(reportTime) {
  if (reportTime === "AM") return "SAME_DAY";
  if (reportTime === "PM") return "NEXT_DAY";
  return "PRIMARY_SESSION";
}

function buildEarningsIntelligence(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const epsActual = toNumber(row?.eps_actual ?? row?.epsActual);
    const epsEstimate = toNumber(row?.eps_estimate ?? row?.epsEstimated);
    const prePrice = toNumber(row?.pre_price ?? row?.prePrice);
    const postPrice = toNumber(row?.post_price ?? row?.postPrice);
    const reportTime = normalizeReportTime(row?.report_time ?? row?.reportTime);
    const preMovePercent = toNumber(row?.pre_move_percent ?? row?.preMovePercent);
    const postMovePercent = toNumber(row?.post_move_percent ?? row?.postMovePercent);
    const fallbackMove = toNumber(row?.actual_move_percent ?? row?.actualMove);
    const actualMovePercent = postMovePercent ?? (prePrice !== null && postPrice !== null && prePrice !== 0
      ? Number((((postPrice - prePrice) / prePrice) * 100).toFixed(2))
      : fallbackMove);
    const beat = epsActual !== null && epsEstimate !== null ? epsActual > epsEstimate : null;

    return {
      ...row,
      report_time: reportTime,
      eps_actual: epsActual,
      eps_estimate: epsEstimate,
      expected_move_percent: toNumber(row?.expected_move_percent ?? row?.expectedMove),
      pre_move_percent: preMovePercent,
      post_move_percent: postMovePercent ?? actualMovePercent,
      actual_move_percent: actualMovePercent,
      true_reaction_window: getTrueReactionWindow(reportTime),
      day1_close: toNumber(row?.day1_close ?? row?.day1Close),
      day3_close: toNumber(row?.day3_close ?? row?.day3Close),
      beat,
    };
  });
}

function calculateDrift(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const postPrice = toNumber(row?.post_price ?? row?.postPrice);
    const day1Close = toNumber(row?.day1_close ?? row?.day1Close);
    const day3Close = toNumber(row?.day3_close ?? row?.day3Close);

    const drift1d = day1Close !== null && postPrice !== null && postPrice !== 0
      ? Number((((day1Close - postPrice) / postPrice) * 100).toFixed(2))
      : null;

    const drift3d = day3Close !== null && postPrice !== null && postPrice !== 0
      ? Number((((day3Close - postPrice) / postPrice) * 100).toFixed(2))
      : null;

    return {
      ...row,
      drift1d,
      drift3d,
    };
  });
}

function buildTradeProbability(rows) {
  const normalized = buildEarningsIntelligence(rows);
  const beats = normalized.filter((row) => row.beat);
  const upAfterBeat = beats.filter((row) => (toNumber(row.post_move_percent) || 0) > 0).length / (beats.length || 1);

  return {
    beatFollowThrough: Number(upAfterBeat.toFixed(4)),
    reliabilityScore: Number((upAfterBeat * normalized.length).toFixed(2)),
  };
}

function buildDecisionScore({ earningsEdge, regime }) {
  let score = 0;

  const edgeScore = Number(earningsEdge?.edge_score ?? earningsEdge?.edgeScore ?? 0);
  const beatRate = Number(earningsEdge?.beat_rate ?? earningsEdge?.beatRate ?? 0);
  const consistency = Number(earningsEdge?.consistency ?? earningsEdge?.consistencyScore ?? 0);
  const directionalBias = String(earningsEdge?.directional_bias ?? earningsEdge?.directionalBias ?? 'MIXED');

  if (edgeScore >= 75) score += 3;
  else if (edgeScore >= 55) score += 2;
  else if (edgeScore >= 35) score += 1;

  if (beatRate > 0.6) score += 1;
  if (consistency <= 3) score += 1;
  if (directionalBias === 'UPSIDE') score += 1;
  if (directionalBias === 'DOWNSIDE') score -= 1;

  if (regime === "TRENDING_UP") score += 2;
  if (regime === "RISK_OFF") score -= 2;

  return score;
}

function buildEarningsEdge(rows) {
  const valid = buildEarningsIntelligence(rows).filter((row) => row.eps_actual !== null && row.eps_estimate !== null);
  if (!valid.length) {
    return {
      beatRate: 0,
      missRate: 0,
      avgMove: 0,
      beatAvgMove: 0,
      consistencyScore: 0,
    };
  }

  const beatCount = valid.filter((row) => row.eps_actual > row.eps_estimate).length;
  const missCount = valid.length - beatCount;
  const avgMove = valid.reduce((sum, row) => sum + (row.actual_move_percent || 0), 0) / valid.length;
  const beatAvgMove = valid
    .filter((row) => row.eps_actual > row.eps_estimate)
    .reduce((sum, row) => sum + (row.actual_move_percent || 0), 0) / (beatCount || 1);

  return {
    beatRate: Number((beatCount / valid.length).toFixed(4)),
    missRate: Number((missCount / valid.length).toFixed(4)),
    avgMove: Number(avgMove.toFixed(2)),
    beatAvgMove: Number(beatAvgMove.toFixed(2)),
    consistencyScore: Number((Math.abs(beatAvgMove) * (beatCount / valid.length)).toFixed(2)),
  };
}

function buildEarningsInsight({ earnings, price, atr }) {
  const history = buildEarningsIntelligence(Array.isArray(earnings?.history) ? earnings.history.slice(0, 8) : []);
  const edge = buildEarningsEdge(history);
  const surpriseSeries = history
    .map((row) => toNumber(row?.surprise_percent ?? row?.surprisePercent))
    .filter((value) => value !== null);
  const expectedMoves = history
    .map((row) => toNumber(row?.expected_move_percent ?? row?.expectedMove))
    .filter((value) => value !== null);

  const normalizedPrice = toNumber(price) || 0;
  const normalizedAtr = toNumber(atr);
  const averageExpectedMove = average(expectedMoves);
  const expectedMove = averageExpectedMove !== null
    ? Number(averageExpectedMove.toFixed(2))
    : normalizedAtr !== null && normalizedPrice > 0
      ? Number(((normalizedAtr / normalizedPrice) * 100).toFixed(2))
      : 4;
  const tradeable = expectedMove >= 3;

  return {
    beatRate: Number((edge.beatRate * 100).toFixed(2)),
    missRate: Number((edge.missRate * 100).toFixed(2)),
    avgSurprise: Number((average(surpriseSeries) || 0).toFixed(2)),
    expectedMove: Number(expectedMove.toFixed(2)),
    tradeable,
  };
}

module.exports = {
  buildDecisionScore,
  buildEarningsEdge,
  buildEarningsIntelligence,
  buildEarningsInsight,
  buildTradeProbability,
  calculateDrift,
  normalizeReportTime,
};