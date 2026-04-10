const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { loadAndValidateTruth } = require('./_truthGuard');

function resolveUkSession(now = new Date()) {
  const london = new Date(now.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
  const minutes = london.getHours() * 60 + london.getMinutes();

  if (minutes >= 9 * 60 && minutes < 14 * 60 + 30) return 'PREMARKET';
  if (minutes >= 14 * 60 + 30 && minutes < 16 * 60) return 'OPEN';
  if (minutes >= 16 * 60 && minutes < 21 * 60) return 'MIDDAY';
  return 'CLOSE';
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function runSessionContextEngine() {
  const startedAt = Date.now();

  loadAndValidateTruth({
    requiredTables: {
      opportunity_stream: ['id', 'symbol', 'event_type', 'source', 'confidence', 'gap_percent', 'trade_class', 'updated_at'],
      market_metrics: ['symbol', 'volume', 'source'],
      trade_setups: ['symbol', 'setup', 'score', 'setup_type', 'updated_at'],
    },
    requiredMappings: ['batch-quote'],
  });

  const session = resolveUkSession();

  const { rows } = await queryWithTimeout(
    `SELECT
       os.id,
       os.symbol,
       os.confidence,
       os.gap_percent,
       mm.volume,
       ts.setup,
       ts.setup_type
     FROM opportunity_stream os
     LEFT JOIN market_metrics mm ON mm.symbol = os.symbol AND mm.source = 'real'
     LEFT JOIN trade_setups ts ON ts.symbol = os.symbol
     WHERE os.source = 'real'
       AND os.event_type = 'signal_quality_engine'
     ORDER BY os.score DESC
     LIMIT 20`,
    [],
    { timeoutMs: 12000, label: 'engines.sessionContextEngine.select_rows', maxRetries: 0 }
  );

  let updated = 0;
  let removedForOpen = 0;

  for (const row of rows) {
    const symbol = String(row.symbol || '').trim().toUpperCase();
    const volume = asNumber(row.volume, 0);

    if (session === 'OPEN' && volume <= 500000) {
      await queryWithTimeout(
        `DELETE FROM opportunity_stream WHERE id = $1`,
        [row.id],
        { timeoutMs: 5000, label: 'engines.sessionContextEngine.delete_low_volume_open', maxRetries: 0 }
      );
      await queryWithTimeout(
        `DELETE FROM trade_setups WHERE symbol = $1`,
        [symbol],
        { timeoutMs: 5000, label: 'engines.sessionContextEngine.delete_trade_setup_open', maxRetries: 0 }
      );
      removedForOpen += 1;
      continue;
    }

    let confidence = asNumber(row.confidence, 50);

    if (session === 'PREMARKET') {
      confidence += Math.min(10, Math.abs(asNumber(row.gap_percent, 0)));
    }

    if (session === 'MIDDAY') {
      confidence -= 10;
    }

    confidence = clamp(confidence, 0, 100);

    await queryWithTimeout(
      `UPDATE opportunity_stream
       SET confidence = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [row.id, confidence],
      { timeoutMs: 5000, label: 'engines.sessionContextEngine.update_stream_confidence', maxRetries: 0 }
    );

    let setupPayload = {};
    if (row.setup) {
      try {
        setupPayload = JSON.parse(row.setup);
      } catch (_err) {
        setupPayload = {};
      }
    }
    const updatedSetup = {
      ...setupPayload,
      session,
      confidence,
      source: 'real',
    };

    await queryWithTimeout(
      `UPDATE trade_setups
       SET setup = $2,
           score = $3,
           setup_type = $4,
           updated_at = NOW()
       WHERE symbol = $1`,
      [symbol, JSON.stringify(updatedSetup), confidence, `${row.setup_type || 'Signal'} [${session}]`],
      { timeoutMs: 5000, label: 'engines.sessionContextEngine.update_trade_setup', maxRetries: 0 }
    );

    updated += 1;
  }

  logger.info('[SESSION CONTEXT ENGINE]', {
    session,
    updated,
    removedForOpen,
    runtimeMs: Date.now() - startedAt,
  });

  return {
    session,
    updated,
    removedForOpen,
    runtimeMs: Date.now() - startedAt,
  };
}

module.exports = {
  resolveUkSession,
  runSessionContextEngine,
};
