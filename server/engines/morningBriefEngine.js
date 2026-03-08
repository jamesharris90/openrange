const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { generateMorningNarrative } = require('../services/mcpClient');
const { sendBriefingEmail } = require('../services/emailService');

async function ensureMorningBriefingsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS morning_briefings (
      id BIGSERIAL PRIMARY KEY,
      as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
      signals JSONB NOT NULL DEFAULT '[]'::jsonb,
      market JSONB NOT NULL DEFAULT '[]'::jsonb,
      news JSONB NOT NULL DEFAULT '[]'::jsonb,
      narrative JSONB NOT NULL DEFAULT '{}'::jsonb,
      email_status JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.morning_brief.ensure_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE morning_briefings ADD COLUMN IF NOT EXISTS as_of_date DATE NOT NULL DEFAULT CURRENT_DATE',
    [],
    { timeoutMs: 5000, label: 'engines.morning_brief.ensure_as_of_date', maxRetries: 0 }
  );
  await queryWithTimeout(
    "ALTER TABLE morning_briefings ADD COLUMN IF NOT EXISTS narrative JSONB NOT NULL DEFAULT '{}'::jsonb",
    [],
    { timeoutMs: 5000, label: 'engines.morning_brief.ensure_narrative', maxRetries: 0 }
  );
  await queryWithTimeout(
    "ALTER TABLE morning_briefings ADD COLUMN IF NOT EXISTS email_status JSONB NOT NULL DEFAULT '{}'::jsonb",
    [],
    { timeoutMs: 5000, label: 'engines.morning_brief.ensure_email_status', maxRetries: 0 }
  );
}

async function getSignals() {
  const { rows } = await queryWithTimeout(
    `SELECT symbol, strategy, class, score, updated_at
     FROM strategy_signals
     WHERE updated_at >= NOW() - interval '24 hours'
     ORDER BY score DESC NULLS LAST
     LIMIT 12`,
    [],
    { timeoutMs: 7000, label: 'engines.morning_brief.signals', maxRetries: 0 }
  );
  return rows;
}

async function getMarketSnapshot() {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol, price, change_percent, updated_at
       FROM market_metrics
       WHERE symbol IN ('SPY','QQQ','IWM','DIA','VIX')
       ORDER BY symbol ASC`,
      [],
      { timeoutMs: 7000, label: 'engines.morning_brief.market', maxRetries: 0 }
    );
    return rows;
  } catch (error) {
    logger.warn('[MORNING_BRIEF] market snapshot unavailable', {
      message: error.message,
    });
    return [];
  }
}

async function getNewsPulse() {
  const { rows } = await queryWithTimeout(
    `SELECT headline, source, url, published_at, summary, symbols, news_score
     FROM news_articles
     WHERE published_at >= NOW() - interval '36 hours'
     ORDER BY published_at DESC NULLS LAST
     LIMIT 20`,
    [],
    { timeoutMs: 8000, label: 'engines.morning_brief.news', maxRetries: 0 }
  );
  return rows;
}

async function runMorningBriefEngine(options = {}) {
  const startedAt = Date.now();
  await ensureMorningBriefingsTable();

  const [signals, market, news] = await Promise.all([
    getSignals(),
    getMarketSnapshot(),
    getNewsPulse(),
  ]);

  const context = { signals, market, news };
  const narrative = await generateMorningNarrative(context);

  const insertResult = await queryWithTimeout(
    `INSERT INTO morning_briefings (
      signals,
      market,
      news,
      narrative,
      email_status
    ) VALUES (
      $1::jsonb,
      $2::jsonb,
      $3::jsonb,
      $4::jsonb,
      $5::jsonb
    )
    RETURNING id, created_at`,
    [
      JSON.stringify(signals),
      JSON.stringify(market),
      JSON.stringify(news),
      JSON.stringify(narrative),
      JSON.stringify({ sent: false, state: 'pending' }),
    ],
    { timeoutMs: 9000, label: 'engines.morning_brief.insert', maxRetries: 0 }
  );

  const record = insertResult.rows[0] || {};
  const briefing = {
    id: record.id,
    createdAt: record.created_at || new Date().toISOString(),
    signals,
    market,
    news,
    narrative,
  };

  let emailStatus = { sent: false, reason: 'not_requested' };
  const shouldEmail = options.sendEmail !== false;
  if (shouldEmail) {
    try {
      emailStatus = await sendBriefingEmail(briefing, options.recipientOverride);
    } catch (error) {
      emailStatus = { sent: false, reason: 'send_failed', detail: error.message };
      logger.error('[MORNING_BRIEF] email send failed', { message: error.message });
    }
  }

  await queryWithTimeout(
    `UPDATE morning_briefings
     SET email_status = $1::jsonb
     WHERE id = $2`,
    [JSON.stringify(emailStatus), briefing.id],
    { timeoutMs: 5000, label: 'engines.morning_brief.update_email_status', maxRetries: 0 }
  );

  const runtimeMs = Date.now() - startedAt;
  logger.info('[MORNING_BRIEF] completed', {
    id: briefing.id,
    signals: signals.length,
    market: market.length,
    news: news.length,
    emailSent: Boolean(emailStatus.sent),
    runtimeMs,
  });

  return {
    ...briefing,
    emailStatus,
    runtimeMs,
  };
}

async function runMorningBrief(options = {}) {
  const testEmail = options?.testEmail ? String(options.testEmail).trim() : null;
  return runMorningBriefEngine({
    ...options,
    recipientOverride: testEmail || options.recipientOverride,
    sendEmail: options.sendEmail !== false,
  });
}

module.exports = {
  runMorningBriefEngine,
  runMorningBrief,
};
