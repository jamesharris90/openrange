const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { loadAndValidateTruth } = require('./_truthGuard');

function asNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function classifySignal(absChangePercent, relativeVolume) {
  if (absChangePercent < 3) return 'EARLY';
  if (absChangePercent <= 6) return 'CONFIRMING';
  if (relativeVolume > 2) return 'EXTENDED';
  return 'REJECTED';
}

async function runSignalQualityEngine() {
  const startedAt = Date.now();

  await queryWithTimeout(
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS raw_score NUMERIC',
    [],
    { timeoutMs: 7000, label: 'engines.signalQualityEngine.ensure_raw_score', maxRetries: 0 }
  ).catch(() => null);

  loadAndValidateTruth({
    requiredTables: {
      market_metrics: ['symbol', 'price', 'change_percent', 'volume', 'previous_close', 'relative_volume', 'source', 'updated_at'],
      opportunity_stream: ['id', 'symbol', 'event_type', 'headline', 'score', 'source', 'created_at', 'change_percent', 'gap_percent', 'relative_volume', 'trade_class', 'updated_at'],
    },
    requiredMappings: ['batch-quote', 'batch-exchange-quote'],
  });

  const { rows } = await queryWithTimeout(
    `SELECT
       symbol,
       price,
       change_percent,
       volume,
       previous_close,
       relative_volume,
       source,
       updated_at
     FROM market_metrics
     WHERE source = 'real'
       AND updated_at > NOW() - INTERVAL '30 minutes'`,
    [],
    { timeoutMs: 12000, label: 'engines.signalQualityEngine.select_market_metrics', maxRetries: 0 }
  );

  const scored = [];
  for (const row of rows || []) {
    const symbol = String(row.symbol || '').trim().toUpperCase();
    const price = asNumber(row.price);
    const previousClose = asNumber(row.previous_close);
    const changePercent = asNumber(row.change_percent);
    const volume = asNumber(row.volume, 0);
    const relativeVolumeRaw = asNumber(row.relative_volume);
    const relativeVolume = relativeVolumeRaw === null ? 1 : relativeVolumeRaw;

    if (!symbol || price === null || changePercent === null || previousClose === null || previousClose === 0) {
      continue;
    }

    const gapPercent = ((price - previousClose) / previousClose) * 100;
    const moveStrength = Math.abs(changePercent);
    const volumeQuality = volume > 300000;
    const earlyMove = Math.abs(changePercent) < 6;
    const notExtended = Math.abs(changePercent) < 8;

    if (!(moveStrength > 2 && volumeQuality && earlyMove && notExtended)) {
      continue;
    }

    const tradeClass = classifySignal(Math.abs(changePercent), relativeVolume);
    if (tradeClass === 'REJECTED') {
      continue;
    }

    const rawScore = (changePercent * 2) + (gapPercent * 3) + (relativeVolume * 5);

    scored.push({
      symbol,
      price,
      change_percent: changePercent,
      gap_percent: gapPercent,
      relative_volume: relativeVolume,
      score: rawScore,
      raw_score: rawScore,
      trade_class: tradeClass,
    });
  }

  const topSignals = scored.sort((a, b) => b.score - a.score).slice(0, 20);

  if (topSignals.length < 5) {
    throw new Error(`signal quality gate failed; count=${topSignals.length}`);
  }

  await queryWithTimeout(
    `DELETE FROM opportunity_stream
     WHERE source = 'real'
       AND event_type = 'signal_quality_engine'`,
    [],
    { timeoutMs: 8000, label: 'engines.signalQualityEngine.clear_previous', maxRetries: 0 }
  );

  for (const signal of topSignals) {
    await queryWithTimeout(
      `INSERT INTO opportunity_stream (
        symbol,
        event_type,
        headline,
        score,
        source,
        created_at,
        updated_at,
        raw_score,
        change_percent,
        gap_percent,
        relative_volume,
        trade_class
      ) VALUES (
        $1,
        'signal_quality_engine',
        $2,
        $3,
        'real',
        NOW(),
        NOW(),
        $4,
        $5,
        $6,
        $7,
        $8
      )`,
      [
        signal.symbol,
        `Signal candidate ${signal.symbol}`,
        signal.score,
        signal.raw_score,
        signal.change_percent,
        signal.gap_percent,
        signal.relative_volume,
        signal.trade_class,
      ],
      { timeoutMs: 6000, label: 'engines.signalQualityEngine.insert_signal', maxRetries: 0 }
    );
  }

  logger.info('[SIGNAL ENGINE]', {
    count: topSignals.length,
    runtimeMs: Date.now() - startedAt,
  });
  console.log(`[SIGNAL ENGINE] count=${topSignals.length}`);

  return {
    count: topSignals.length,
    runtimeMs: Date.now() - startedAt,
  };
}

module.exports = {
  runSignalQualityEngine,
};
