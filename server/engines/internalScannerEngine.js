const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function asNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function ensureOpportunityStreamColumns() {
  const alters = [
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS change_percent NUMERIC',
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS gap_percent NUMERIC',
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS relative_volume NUMERIC',
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS confidence NUMERIC',
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS raw_score NUMERIC',
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS expected_move NUMERIC',
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS trade_class TEXT',
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS why TEXT',
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS how TEXT',
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS catalyst_type TEXT',
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS earnings_flag BOOLEAN',
    'ALTER TABLE opportunity_stream ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()',
  ];

  for (const sql of alters) {
    await queryWithTimeout(sql, [], { timeoutMs: 6000, label: 'engines.internalScannerEngine.ensure_stream_columns', maxRetries: 0 });
  }
}

async function runInternalScannerEngine() {
  const startedAt = Date.now();
  await ensureOpportunityStreamColumns();

  const { rows } = await queryWithTimeout(
    `SELECT
       symbol,
       price,
       change_percent,
       volume,
       avg_volume_30d,
       previous_close,
       updated_at,
       source
     FROM market_metrics
     WHERE source = 'real'
       AND updated_at > NOW() - INTERVAL '30 minutes'`,
    [],
    { timeoutMs: 12000, label: 'engines.internalScannerEngine.select_metrics', maxRetries: 0 }
  );

  if (!rows.length) {
    throw new Error('internal scanner found no real market metrics');
  }

  const scored = rows.map((row) => {
    const price = asNumber(row.price, 0);
    const previousClose = asNumber(row.previous_close, 0);
    const changePercent = asNumber(row.change_percent, 0);
    const volume = asNumber(row.volume, 0);
    const avgVolume30d = asNumber(row.avg_volume_30d, 0);
    const gapPercent = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0;
    const relativeVolume = avgVolume30d > 0 ? volume / avgVolume30d : null;
    const rawScore =
      (changePercent * 2) +
      (gapPercent * 3) +
      (relativeVolume !== null ? relativeVolume * 5 : 0);

    return {
      symbol: String(row.symbol || '').trim().toUpperCase(),
      price,
      change_percent: changePercent,
      gap_percent: gapPercent,
      relative_volume: relativeVolume,
      volume,
      score: rawScore,
      raw_score: rawScore,
    };
  }).filter((row) => row.symbol);

  const inPlay = scored.filter((m) =>
    Math.abs(m.change_percent) > 2 ||
    Math.abs(m.gap_percent) > 2 ||
    m.volume > 500000
  );

  if (!inPlay.length) {
    throw new Error('internal scanner produced empty output');
  }

  const top = inPlay
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  await queryWithTimeout(
    `DELETE FROM opportunity_stream
     WHERE source = 'real'
       AND event_type = 'internal_scanner'`,
    [],
    { timeoutMs: 10000, label: 'engines.internalScannerEngine.clear_previous', maxRetries: 0 }
  );

  for (const row of top) {
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
        relative_volume
      ) VALUES ($1, 'internal_scanner', $2, $3, 'real', NOW(), NOW(), $4, $5, $6, $7)`,
      [
        row.symbol,
        `Internal scanner move ${row.symbol}`,
        row.score,
        row.raw_score,
        row.change_percent,
        row.gap_percent,
        row.relative_volume,
      ],
      { timeoutMs: 7000, label: 'engines.internalScannerEngine.insert_stream', maxRetries: 0 }
    );
  }

  const ts = new Date().toISOString();
  logger.info('[SCANNER OUTPUT]', {
    count: top.length,
    timestamp: ts,
    runtimeMs: Date.now() - startedAt,
  });
  console.log(`[SCANNER OUTPUT] count=${top.length} ts=${ts}`);

  return {
    count: top.length,
    timestamp: ts,
    runtimeMs: Date.now() - startedAt,
  };
}

module.exports = {
  runInternalScannerEngine,
};
