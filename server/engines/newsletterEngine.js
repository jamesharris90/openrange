const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { sendPremarketNewsletter, ensureNewsletterTables } = require('../services/newsletterService');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getNyMinutesSinceMidnight(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return (hour * 60) + minute;
}

function getNyDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function isPremarketWindow() {
  const mins = getNyMinutesSinceMidnight();
  return mins < (9 * 60 + 30);
}

async function ensureNewsletterEngineTables() {
  await ensureNewsletterTables();

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS daily_signal_snapshot (
      id BIGSERIAL PRIMARY KEY,
      snapshot_date DATE NOT NULL,
      symbol TEXT NOT NULL,
      score NUMERIC,
      confidence TEXT,
      strategy TEXT,
      catalyst TEXT,
      sector TEXT,
      entry_price NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (snapshot_date, symbol)
    )`,
    [],
    { timeoutMs: 7000, label: 'newsletter_engine.ensure_daily_snapshot', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS snapshot_date DATE DEFAULT CURRENT_DATE`,
    [],
    { timeoutMs: 7000, label: 'newsletter_engine.alter_snapshot_date', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS symbol TEXT`,
    [],
    { timeoutMs: 7000, label: 'newsletter_engine.alter_snapshot_symbol', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS score NUMERIC`,
    [],
    { timeoutMs: 7000, label: 'newsletter_engine.alter_snapshot_score', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS confidence TEXT`,
    [],
    { timeoutMs: 7000, label: 'newsletter_engine.alter_snapshot_confidence', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS strategy TEXT`,
    [],
    { timeoutMs: 7000, label: 'newsletter_engine.alter_snapshot_strategy', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS catalyst TEXT`,
    [],
    { timeoutMs: 7000, label: 'newsletter_engine.alter_snapshot_catalyst', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS sector TEXT`,
    [],
    { timeoutMs: 7000, label: 'newsletter_engine.alter_snapshot_sector', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS entry_price NUMERIC`,
    [],
    { timeoutMs: 7000, label: 'newsletter_engine.alter_snapshot_entry_price', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE daily_signal_snapshot
       ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    [],
    { timeoutMs: 7000, label: 'newsletter_engine.alter_snapshot_created_at', maxRetries: 0 }
  );
}

async function capturePremarketSignalSnapshot(topSignals) {
  if (!isPremarketWindow()) {
    return { inserted: 0, skipped: true };
  }

  if (!topSignals.length) {
    return { inserted: 0, skipped: false };
  }

  const snapshotDate = getNyDateKey();

  const symbols = [];
  const scores = [];
  const confidences = [];
  const strategies = [];
  const catalysts = [];
  const sectors = [];
  const entryPrices = [];

  for (const row of topSignals) {
    symbols.push(String(row.symbol || '').toUpperCase());
    scores.push(toNumber(row.score));
    confidences.push(row.confidence || null);
    strategies.push(row.strategy || null);
    catalysts.push(row.catalyst || null);
    sectors.push(row.sector || null);
    entryPrices.push(toNumber(row.entry_price, null));
  }

  await queryWithTimeout(
    `DELETE FROM daily_signal_snapshot
     WHERE snapshot_date = $1::date
       AND symbol = ANY($2::text[])`,
    [snapshotDate, symbols],
    { timeoutMs: 7000, label: 'newsletter_engine.delete_existing_snapshot_rows', maxRetries: 0 }
  );

  const result = await queryWithTimeout(
    `INSERT INTO daily_signal_snapshot (
       snapshot_date,
       symbol,
       score,
       confidence,
       strategy,
       catalyst,
       sector,
       entry_price,
       created_at
     )
     SELECT
       $1::date,
       incoming.symbol,
       incoming.score,
       incoming.confidence,
       incoming.strategy,
       incoming.catalyst,
       incoming.sector,
       incoming.entry_price,
       NOW()
     FROM (
       SELECT
         unnest($2::text[]) AS symbol,
         unnest($3::numeric[]) AS score,
         unnest($4::text[]) AS confidence,
         unnest($5::text[]) AS strategy,
         unnest($6::text[]) AS catalyst,
         unnest($7::text[]) AS sector,
         unnest($8::numeric[]) AS entry_price
     ) incoming`,
    [snapshotDate, symbols, scores, confidences, strategies, catalysts, sectors, entryPrices],
    { timeoutMs: 10000, label: 'newsletter_engine.capture_snapshot', maxRetries: 0 }
  );

  return { inserted: result.rowCount || 0, skipped: false };
}

async function buildNewsletterPayload() {
  await ensureNewsletterEngineTables();

  const [signalsRes, catalystsRes, sectorsRes, narrativeRes, subscriberCountRes, historyRes] = await Promise.all([
    queryWithTimeout(
      `SELECT
         h.symbol,
         h.score,
         h.confidence,
         COALESCE(t.strategy, h.strategy) AS strategy,
         COALESCE(t.catalyst_type, c.catalyst_type, 'unknown') AS catalyst,
         COALESCE(t.sector, 'Unknown') AS sector,
         COALESCE(q.price, 0) AS entry_price,
         h.signal_class,
         h.hierarchy_rank
       FROM signal_hierarchy h
       LEFT JOIN trade_signals t ON t.symbol = h.symbol
       LEFT JOIN LATERAL (
         SELECT catalyst_type
         FROM news_catalysts nc
         WHERE nc.symbol = h.symbol
         ORDER BY nc.published_at DESC NULLS LAST
         LIMIT 1
       ) c ON TRUE
       LEFT JOIN market_quotes q ON q.symbol = h.symbol
       ORDER BY h.hierarchy_rank DESC NULLS LAST
       LIMIT 10`,
      [],
      { timeoutMs: 7000, label: 'newsletter_engine.top_signals', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT symbol, catalyst_type, impact_score
       FROM news_catalysts
       ORDER BY impact_score DESC NULLS LAST
       LIMIT 5`,
      [],
      { timeoutMs: 7000, label: 'newsletter_engine.top_catalysts', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT sector, momentum_score
       FROM sector_momentum
       ORDER BY momentum_score DESC NULLS LAST
       LIMIT 5`,
      [],
      { timeoutMs: 7000, label: 'newsletter_engine.sector_leaders', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT narrative
       FROM market_narratives
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [],
      { timeoutMs: 7000, label: 'newsletter_engine.market_narrative', maxRetries: 0 }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT COUNT(*)::int AS total
       FROM newsletter_subscribers
       WHERE is_active = TRUE`,
      [],
      { timeoutMs: 7000, label: 'newsletter_engine.subscriber_count', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT
         sent_at,
         recipients_count,
         open_rate,
         click_rate,
         status
       FROM newsletter_send_history
       ORDER BY sent_at DESC NULLS LAST
       LIMIT 10`,
      [],
      { timeoutMs: 7000, label: 'newsletter_engine.send_history', maxRetries: 0 }
    ),
  ]);

  const topSignals = signalsRes.rows || [];
  const snapshotStatus = await capturePremarketSignalSnapshot(topSignals);

  return {
    topSignals,
    topCatalysts: catalystsRes.rows || [],
    sectorLeaders: sectorsRes.rows || [],
    marketNarrative: String(narrativeRes.rows?.[0]?.narrative || 'Market breadth mixed into the premarket session.'),
    generatedAt: new Date().toISOString(),
    meta: {
      subscriberCount: subscriberCountRes.rows?.[0]?.total || 0,
      sendHistory: historyRes.rows || [],
      averageOpenRate: (historyRes.rows || []).length
        ? (historyRes.rows || []).reduce((acc, row) => acc + toNumber(row.open_rate), 0) / historyRes.rows.length
        : 0,
      averageClickRate: (historyRes.rows || []).length
        ? (historyRes.rows || []).reduce((acc, row) => acc + toNumber(row.click_rate), 0) / historyRes.rows.length
        : 0,
      snapshotStatus,
    },
  };
}

async function runPremarketNewsletter(options = {}) {
  const payload = await buildNewsletterPayload();
  if (options.sendEmail === false) {
    return { payload, sent: false };
  }

  const sendResult = await sendPremarketNewsletter(payload);
  logger.info('[NEWSLETTER_ENGINE] run complete', {
    sent: sendResult.sent,
    recipients: sendResult.recipients || 0,
    topSignals: payload.topSignals.length,
  });

  return {
    payload,
    ...sendResult,
  };
}

module.exports = {
  runPremarketNewsletter,
  buildNewsletterPayload,
  ensureNewsletterEngineTables,
};
