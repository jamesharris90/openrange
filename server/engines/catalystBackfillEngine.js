const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { runCatalystDetectionEngine } = require('./catalystDetectionEngine');
const { runCatalystIntelligenceEngine } = require('./catalystIntelligenceEngine');
const { runCatalystPrecedentEngine } = require('./catalystPrecedentEngine');
const { runCatalystSignalEngine } = require('./catalystSignalEngine');
const { runCatalystNarrativeEngine } = require('./catalystNarrativeEngine');

const BACKFILL_CURSOR_KEY = 'catalyst_backfill_cursor';

async function ensureSettingsRow() {
  await queryWithTimeout(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, NULL, NOW())
     ON CONFLICT (key) DO NOTHING`,
    [BACKFILL_CURSOR_KEY],
    { timeoutMs: 6000, label: 'catalyst_backfill.ensure_settings', maxRetries: 0 }
  );
}

async function getCursor() {
  const { rows } = await queryWithTimeout(
    `SELECT value
     FROM settings
     WHERE key = $1
     LIMIT 1`,
    [BACKFILL_CURSOR_KEY],
    { timeoutMs: 6000, label: 'catalyst_backfill.get_cursor', maxRetries: 0 }
  );
  return rows[0]?.value || null;
}

async function setCursor(value) {
  await queryWithTimeout(
    `UPDATE settings
     SET value = $2,
         updated_at = NOW()
     WHERE key = $1`,
    [BACKFILL_CURSOR_KEY, value],
    { timeoutMs: 6000, label: 'catalyst_backfill.set_cursor', maxRetries: 0 }
  );
}

async function getOldestUnprocessedPublishedAt() {
  const { rows } = await queryWithTimeout(
    `SELECT MIN(na.published_at) AS oldest_unprocessed
     FROM news_articles na
     WHERE na.symbol IS NOT NULL
       AND LENGTH(TRIM(COALESCE(na.symbol, ''))) > 0
       AND na.headline IS NOT NULL
       AND na.published_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM catalyst_events ce
         WHERE ce.news_id = ABS(MOD((('x' || SUBSTRING(md5(na.id::text), 1, 16))::bit(64)::bigint), 9223372036854775807))::bigint
       )`,
    [],
    { timeoutMs: 12000, label: 'catalyst_backfill.oldest_unprocessed', maxRetries: 0 }
  );

  return rows[0]?.oldest_unprocessed || null;
}

async function runCatalystBackfill(options = {}) {
  const batchSize = Number(options.batchSize) > 0 ? Number(options.batchSize) : 500;
  const maxBatches = Number(options.maxBatches) > 0 ? Number(options.maxBatches) : 30;

  await ensureSettingsRow();

  const backfillStats = {
    batchesRun: 0,
    scanned: 0,
    inserted: 0,
    skippedDuplicates: 0,
    updated: 0,
    signalsCreated: 0,
    cursorBefore: await getCursor(),
    cursorAfter: null,
  };

  for (let i = 0; i < maxBatches; i += 1) {
    const detection = await runCatalystDetectionEngine({ limit: batchSize, onlyMissing: true });
    backfillStats.batchesRun += 1;
    backfillStats.scanned += Number(detection.scanned || 0);
    backfillStats.inserted += Number(detection.inserted || 0);
    backfillStats.skippedDuplicates += Number(detection.skippedDuplicates || 0);

    if (Number(detection.inserted || 0) === 0) {
      break;
    }
  }

  const intelligence = await runCatalystIntelligenceEngine();
  const precedent = await runCatalystPrecedentEngine();
  const signals = await runCatalystSignalEngine();
  const narratives = await runCatalystNarrativeEngine();
  backfillStats.signalsCreated = Number(signals.inserted || 0);

  backfillStats.updated =
    Number(intelligence.inserted || 0)
    + Number(precedent.updated || 0)
    + Number(precedent.inserted || 0)
    + Number(signals.inserted || 0)
    + Number(narratives.updated || 0);

  const cursor = await getOldestUnprocessedPublishedAt();
  backfillStats.cursorAfter = cursor ? new Date(cursor).toISOString() : null;
  await setCursor(backfillStats.cursorAfter || 'complete');

  const result = {
    backfill: backfillStats,
    engines: {
      intelligence,
      precedent,
      signals,
      narratives,
    },
  };

  logger.info('[CATALYST_BACKFILL] completed', result);
  return result;
}

module.exports = {
  runCatalystBackfill,
};
