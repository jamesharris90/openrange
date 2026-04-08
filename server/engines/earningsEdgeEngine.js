function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(digits));
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (!Array.isArray(values) || values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function classifyPatternType({ beat, move }) {
  const isUpMove = move >= 0;

  if (beat && isUpMove) {
    return 'STRONG_BEAT';
  }

  if (beat && !isUpMove) {
    return 'FADE';
  }

  if (!beat && !isUpMove) {
    return 'STRONG_MISS';
  }

  return 'SQUEEZE';
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const date = String(row?.date ?? row?.report_date ?? '').trim();
      const epsActual = toNumber(row?.eps_actual ?? row?.epsActual);
      const epsEstimate = toNumber(row?.eps_estimate ?? row?.epsEstimate);
      const postMovePercent = toNumber(row?.post_move_percent ?? row?.postMovePercent ?? row?.actual_move_percent ?? row?.actualMove);

      if (!date || epsActual === null || epsEstimate === null || postMovePercent === null) {
        return null;
      }

      return {
        date,
        eps_actual: epsActual,
        eps_estimate: epsEstimate,
        post_move_percent: postMovePercent,
        beat: epsActual > epsEstimate,
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function buildEarningsPattern(rows) {
  return rows.map((row) => ({
    type: classifyPatternType({ beat: row.beat, move: row.post_move_percent }),
    move: round(row.post_move_percent),
    beat: row.beat,
    date: row.date,
  }));
}

function computeDirectionalBias({ avgMove, positiveRate, negativeRate, beatRate }) {
  if (avgMove >= 1 && positiveRate >= 0.625 && beatRate >= 0.5) {
    return 'UPSIDE';
  }

  if (avgMove <= -1 && negativeRate >= 0.625 && beatRate <= 0.5) {
    return 'DOWNSIDE';
  }

  if (avgMove > 0.5 && positiveRate > negativeRate) {
    return 'UPSIDE';
  }

  if (avgMove < -0.5 && negativeRate > positiveRate) {
    return 'DOWNSIDE';
  }

  return 'MIXED';
}

function computeEdgeScore({ sampleSize, avgMove, consistency, beatRate, positiveRate, negativeRate, beatPositiveRate, missNegativeRate }) {
  const sampleScore = clamp((sampleSize / 8) * 20, 0, 20);
  const moveScore = clamp((Math.abs(avgMove) / 6) * 30, 0, 30);
  const consistencyScore = clamp(((8 - consistency) / 8) * 20, 0, 20);
  const biasStrength = Math.abs(positiveRate - negativeRate);
  const beatAlignment = average([
    beatPositiveRate,
    missNegativeRate,
    Math.abs((beatRate || 0) - 0.5) * 2,
    biasStrength,
  ]);
  const alignmentScore = clamp(beatAlignment * 30, 0, 30);

  return round(sampleScore + moveScore + consistencyScore + alignmentScore, 1);
}

function classifyEdgeLabel(edgeScore, sampleSize) {
  if (sampleSize < 3) {
    return 'NO_EDGE';
  }

  if (edgeScore >= 75) {
    return 'HIGH_EDGE';
  }

  if (edgeScore >= 55) {
    return 'MODERATE_EDGE';
  }

  if (edgeScore >= 35) {
    return 'LOW_EDGE';
  }

  return 'NO_EDGE';
}

function buildEarningsRead({ sampleSize, edgeLabel, directionalBias, beatRate, avgMove, avgUpMove, avgDownMove, consistency, positiveRate, negativeRate }) {
  if (sampleSize < 3) {
    return 'Too little earnings reaction history. No edge.';
  }

  if (edgeLabel === 'NO_EDGE' || directionalBias === 'MIXED') {
    if (beatRate >= 0.75 && Math.abs(avgMove) < 0.75) {
      return 'Beats are frequent, but post-print follow-through is weak. Wait for confirmation.';
    }

    return 'Mixed earnings behavior with uneven post-print reaction. No reliable edge.';
  }

  if (directionalBias === 'UPSIDE') {
    if (beatRate >= 0.625 && avgMove >= 2 && consistency <= 3) {
      return 'Consistent beats with strong upside reaction. Favor continuation.';
    }

    if (beatRate >= 0.5 && avgUpMove > Math.abs(avgDownMove)) {
      return 'Earnings reactions skew higher, but follow-through is not clean. Trade only with confirmation.';
    }

    if (positiveRate >= 0.625) {
      return 'Post-earnings reactions lean higher. Bias favors upside only if momentum confirms.';
    }
  }

  if (directionalBias === 'DOWNSIDE') {
    if (beatRate >= 0.625 && negativeRate >= 0.625) {
      return 'Beats are frequent, but price still fades after earnings. Respect downside risk.';
    }

    if (beatRate <= 0.375 && avgMove <= -2 && consistency <= 3.5) {
      return 'Repeated misses with downside follow-through. Risk skewed lower.';
    }

    if (negativeRate >= 0.625 && Math.abs(avgDownMove) >= Math.abs(avgUpMove)) {
      return 'Post-earnings reactions trend lower. Respect downside risk after the print.';
    }
  }

  return 'Earnings edge is present, but reaction spread is wide. Wait for confirmation.';
}

function buildEarningsEdge(rows) {
  const normalized = normalizeRows(rows);
  const sampleSize = normalized.length;

  if (!sampleSize) {
    return {
      beat_rate: 0,
      avg_move: 0,
      avg_up_move: 0,
      avg_down_move: 0,
      directional_bias: 'MIXED',
      consistency: 0,
      edge_score: 0,
      edge_label: 'NO_EDGE',
      read: 'No earnings reaction history. No edge.',
      sample_size: 0,
      earnings_pattern: [],
    };
  }

  const moves = normalized.map((row) => row.post_move_percent);
  const beats = normalized.filter((row) => row.beat);
  const misses = normalized.filter((row) => !row.beat);
  const positiveMoves = normalized.filter((row) => row.post_move_percent > 0).map((row) => row.post_move_percent);
  const negativeMoves = normalized.filter((row) => row.post_move_percent < 0).map((row) => row.post_move_percent);

  const beatRate = beats.length / sampleSize;
  const avgMove = average(moves);
  const avgUpMove = positiveMoves.length ? average(positiveMoves) : 0;
  const avgDownMove = negativeMoves.length ? average(negativeMoves) : 0;
  const consistency = standardDeviation(moves);
  const positiveRate = positiveMoves.length / sampleSize;
  const negativeRate = negativeMoves.length / sampleSize;
  const beatPositiveRate = beats.length ? beats.filter((row) => row.post_move_percent > 0).length / beats.length : 0;
  const missNegativeRate = misses.length ? misses.filter((row) => row.post_move_percent < 0).length / misses.length : 0;
  const directionalBias = computeDirectionalBias({ avgMove, positiveRate, negativeRate, beatRate });
  const edgeScore = computeEdgeScore({
    sampleSize,
    avgMove,
    consistency,
    beatRate,
    positiveRate,
    negativeRate,
    beatPositiveRate,
    missNegativeRate,
  });
  const edgeLabel = classifyEdgeLabel(edgeScore, sampleSize);
  const earningsPattern = buildEarningsPattern(normalized);

  return {
    beat_rate: round(beatRate, 4),
    avg_move: round(avgMove),
    avg_up_move: round(avgUpMove),
    avg_down_move: round(avgDownMove),
    directional_bias: directionalBias,
    consistency: round(consistency),
    edge_score: edgeScore,
    edge_label: edgeLabel,
    read: buildEarningsRead({
      sampleSize,
      edgeLabel,
      directionalBias,
      beatRate,
      avgMove,
      avgUpMove,
      avgDownMove,
      consistency,
      positiveRate,
      negativeRate,
    }),
    sample_size: sampleSize,
    earnings_pattern: earningsPattern,
  };
}

module.exports = {
  buildEarningsEdge,
};