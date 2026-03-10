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
  await queryWithTimeout(
    "ALTER TABLE morning_briefings ADD COLUMN IF NOT EXISTS stocks_in_play JSONB NOT NULL DEFAULT '[]'::jsonb",
    [],
    { timeoutMs: 5000, label: 'engines.morning_brief.ensure_stocks_in_play', maxRetries: 0 }
  );
}

async function getSignals() {
  const { rows } = await queryWithTimeout(
    `SELECT
       s.symbol,
       s.strategy,
       s.score,
       s.confidence,
       s.narrative,
       COALESCE(s.catalyst_type, c.catalyst_type, 'unknown') AS catalyst_type,
       s.updated_at,
       COALESCE(m.relative_volume, 0) AS rvol
     FROM trade_signals s
     LEFT JOIN market_metrics m ON m.symbol = s.symbol
     LEFT JOIN LATERAL (
       SELECT nc.catalyst_type
       FROM news_catalysts nc
       WHERE nc.symbol = s.symbol
       ORDER BY nc.published_at DESC NULLS LAST
       LIMIT 1
     ) c ON TRUE
     ORDER BY s.score DESC NULLS LAST
     LIMIT 5`,
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

async function getTopStocksInPlay() {
  const { rows } = await queryWithTimeout(
    `SELECT symbol, strategy, score, gap_percent, rvol, atr_percent, created_at
     FROM trade_signals
     ORDER BY score DESC NULLS LAST
     LIMIT 5`,
    [],
    { timeoutMs: 7000, label: 'engines.morning_brief.stocks_in_play', maxRetries: 0 }
  );
  return rows;
}

async function getTopCatalysts() {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol, catalyst_type, headline, impact_score, published_at
       FROM news_catalysts
       ORDER BY impact_score DESC NULLS LAST, published_at DESC NULLS LAST
       LIMIT 5`,
      [],
      { timeoutMs: 7000, label: 'engines.morning_brief.top_catalysts', maxRetries: 0 }
    );
    return rows;
  } catch (error) {
    logger.warn('[MORNING_BRIEF] top catalysts unavailable', { message: error.message });
    return [];
  }
}

async function getSectorStrengthTop3() {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT sector, market_cap, volume, relative_volume, price_change
       FROM sector_agg
       ORDER BY market_cap DESC NULLS LAST
       LIMIT 3`,
      [],
      { timeoutMs: 7000, label: 'engines.morning_brief.sector_strength', maxRetries: 0 }
    );
    return rows;
  } catch (error) {
    logger.warn('[MORNING_BRIEF] sector strength unavailable', { message: error.message });
    return [];
  }
}

async function getEarningsToday() {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol, company, earnings_date::text AS earnings_date, eps_estimate, revenue_estimate
       FROM earnings_events
       WHERE earnings_date = CURRENT_DATE
       ORDER BY symbol ASC
       LIMIT 10`,
      [],
      { timeoutMs: 7000, label: 'engines.morning_brief.earnings_today', maxRetries: 0 }
    );
    return rows;
  } catch (error) {
    logger.warn('[MORNING_BRIEF] earnings unavailable', { message: error.message });
    return [];
  }
}

async function getMacroMap() {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol, price, change_percent
       FROM market_metrics
       WHERE symbol IN ('USO','GLD','BTCUSD','DXY','TNX','^TNX','SPY','QQQ','VIX')`,
      [],
      { timeoutMs: 7000, label: 'engines.morning_brief.macro_map', maxRetries: 0 }
    );
    return rows;
  } catch (error) {
    logger.warn('[MORNING_BRIEF] macro map unavailable', { message: error.message });
    return [];
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function deriveMarketRegime(marketRows = []) {
  const spy = marketRows.find((row) => row.symbol === 'SPY');
  const qqq = marketRows.find((row) => row.symbol === 'QQQ');
  const vix = marketRows.find((row) => row.symbol === 'VIX');

  const vixLevel = toNumber(vix?.price);
  const spyChange = toNumber(spy?.change_percent);
  const qqqChange = toNumber(qqq?.change_percent);

  if (vixLevel >= 25 || spyChange <= -1.2 || qqqChange <= -1.2) {
    return 'Risk-Off';
  }
  if (vixLevel > 0 && vixLevel <= 17 && spyChange >= 0.5 && qqqChange >= 0.5) {
    return 'Risk-On';
  }
  return 'Neutral';
}

async function runMorningBriefEngine(options = {}) {
  const startedAt = Date.now();
  await ensureMorningBriefingsTable();

  const [signals, market, news, stocksInPlay, topCatalysts, sectorStrength, earningsToday, macroMap] = await Promise.all([
    getSignals(),
    getMarketSnapshot(),
    getNewsPulse(),
    getTopStocksInPlay(),
    getTopCatalysts(),
    getSectorStrengthTop3(),
    getEarningsToday(),
    getMacroMap(),
  ]);

  const marketRegime = deriveMarketRegime(market);
  const topFocus = stocksInPlay.slice(0, 3).map((row) => row.symbol).filter(Boolean);
  const focusText = topFocus.length
    ? `Day 2 continuation setups dominating. Watch ${topFocus.join(', ')}.`
    : 'Opportunity scan running. Monitor top relative-volume names at open.';

  const tradeIdea = stocksInPlay.length
    ? {
        symbol: stocksInPlay[0].symbol,
        setup: stocksInPlay[0].strategy,
        trigger: `Break and hold above intraday VWAP on ${stocksInPlay[0].symbol}`,
        target: '1.5R into momentum continuation',
        risk: 'Exit on VWAP reclaim failure',
      }
    : null;

  const context = {
    signals,
    market,
    news,
    stocksInPlay,
    topCatalysts,
    sectorStrength,
    earningsToday,
    macroMap,
    marketRegime,
    focusText,
    tradeIdea,
  };
  const narrative = await generateMorningNarrative(context);

  const insertResult = await queryWithTimeout(
    `INSERT INTO morning_briefings (
      signals,
      market,
      news,
      stocks_in_play,
      narrative,
      email_status
    ) VALUES (
      $1::jsonb,
      $2::jsonb,
      $3::jsonb,
      $4::jsonb,
      $5::jsonb,
      $6::jsonb
    )
    RETURNING id, created_at`,
    [
      JSON.stringify(signals),
      JSON.stringify(market),
      JSON.stringify(news),
      JSON.stringify(stocksInPlay),
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
    stocksInPlay,
    topCatalysts,
    sectorStrength,
    earningsToday,
    macroMap,
    marketRegime,
    focusText,
    tradeIdea,
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
    stocksInPlay: stocksInPlay.length,
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
