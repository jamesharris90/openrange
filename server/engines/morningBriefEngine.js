const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { generateMorningNarrative, generateSignalStrengthNarrative } = require('../services/mcpClient');
const { sendBriefingEmail } = require('../services/emailService');
const {
  EMAIL_TYPES,
  recordNewsletterSendHistory,
} = require('../services/newsletterService');

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

function getScheduleWindowKey(options = {}) {
  const today = getNyDateKey();
  const windowTag = String(options.scheduleWindowTag || '08:00_ET');
  return `${today}:${windowTag}`;
}

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

function normalizeString(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function buildSignalReasoning(row = {}) {
  const symbol = normalizeString(row.symbol).toUpperCase();
  const strategy = normalizeString(row.strategy || row.signal_strategy || 'Momentum continuation');
  const catalystHeadline = normalizeString(row.catalyst_headline || row.catalyst, 'No major headline catalyst');
  const catalystType = normalizeString(row.catalyst_type || row.catalyst, 'Catalyst');
  const beaconProbability = toNumber(row.beacon_probability, toNumber(row.probability, 0));
  const relativeVolume = toNumber(row.rvol, toNumber(row.relative_volume, 0));
  const gapPercent = toNumber(row.gap_percent, 0);
  const expectedMove = row.expected_move == null ? null : toNumber(row.expected_move, 0);

  return {
    symbol,
    strategy,
    score: toNumber(row.score, 0),
    confidence: normalizeString(row.confidence || row.signal_class || row.class || 'High'),
    probability: beaconProbability,
    beacon_probability: beaconProbability,
    expected_move: expectedMove,
    catalyst_type: catalystType,
    catalyst_headline: catalystHeadline,
    rvol: relativeVolume,
    gap_percent: gapPercent,
    sector: normalizeString(row.sector, 'Unknown'),
    signal_class: normalizeString(row.signal_class || row.class || ''),
    hierarchy_rank: toNumber(row.hierarchy_rank, 0),
    updated_at: row.updated_at || null,
    why_moving: `${symbol} is moving on ${catalystType.toLowerCase()} context: ${catalystHeadline}.`,
    why_tradeable: `${strategy} remains tradeable with RVOL ${relativeVolume.toFixed(2)}${gapPercent ? ` and gap ${gapPercent.toFixed(2)}%` : ''}.`,
    how_to_trade: `Prefer ${strategy} execution only after confirmation of opening range and VWAP behavior; avoid chasing extended candles.`,
    risk_notes: 'Use defined risk at invalidation and reduce size if liquidity thins after open.',
    setup_reasoning: `Beacon probability ${beaconProbability.toFixed(2)} supports a high-conviction continuation profile.`,
  };
}

function isHighConviction(row = {}) {
  const cls = String(row.signal_class || '').toLowerCase();
  if (cls.includes('a+')) return true;
  if (cls.includes('tier 1')) return true;
  if (cls.includes('class a')) return true;
  return toNumber(row.beacon_probability, toNumber(row.probability, 0)) >= 85;
}

function dedupeBySymbol(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const symbol = String(row?.symbol || '').toUpperCase();
    if (!symbol) continue;
    if (!map.has(symbol)) map.set(symbol, row);
  }
  return Array.from(map.values());
}

async function getSignals() {
  const { rows } = await queryWithTimeout(
    `SELECT
       br.symbol,
       COALESCE(br.strategy, ts.strategy, ss.strategy, sh.strategy) AS strategy,
       COALESCE(ts.score, ss.score, sh.score, br.signal_score, 0) AS score,
       COALESCE(ts.confidence, sh.confidence, ss.class, sh.signal_class, 'High') AS confidence,
       COALESCE(ts.narrative, '') AS narrative,
       COALESCE(nc.catalyst_type, ts.catalyst_type, 'unknown') AS catalyst_type,
       COALESCE(nc.headline, ts.catalyst_headline, 'No major headline catalyst') AS catalyst_headline,
       COALESCE(ts.updated_at, ss.updated_at, sh.updated_at) AS updated_at,
       COALESCE(ts.rvol, mm.relative_volume, ss.relative_volume, 0) AS rvol,
       COALESCE(ts.gap_percent, ss.gap_percent, mm.gap_percent, 0) AS gap_percent,
       COALESCE(br.beacon_probability, ss.probability, 0) AS beacon_probability,
       COALESCE(br.expected_move, NULL) AS expected_move,
       COALESCE(sh.signal_class, ss.class, '') AS signal_class,
       COALESCE(sh.hierarchy_rank, 0) AS hierarchy_rank,
       COALESCE(mq.sector, 'Unknown') AS sector
     FROM beacon_rankings br
     LEFT JOIN signal_hierarchy sh ON sh.symbol = br.symbol
     LEFT JOIN trade_signals ts ON ts.symbol = br.symbol
     LEFT JOIN strategy_signals ss ON ss.symbol = br.symbol
     LEFT JOIN market_metrics mm ON mm.symbol = br.symbol
     LEFT JOIN market_quotes mq ON mq.symbol = br.symbol
     LEFT JOIN LATERAL (
       SELECT nc.catalyst_type, nc.headline
       FROM news_catalysts nc
       WHERE nc.symbol = br.symbol
       ORDER BY nc.published_at DESC NULLS LAST
       LIMIT 1
     ) nc ON TRUE
     WHERE br.symbol IS NOT NULL
       AND btrim(br.symbol) <> ''
     ORDER BY br.beacon_probability DESC NULLS LAST,
              sh.hierarchy_rank DESC NULLS LAST,
              COALESCE(ts.score, ss.score, sh.score, br.signal_score, 0) DESC NULLS LAST,
              br.symbol ASC
     LIMIT 40`,
    [],
    { timeoutMs: 9000, label: 'engines.morning_brief.signals', maxRetries: 0 }
  );

  const normalized = dedupeBySymbol((rows || []).map((row) => buildSignalReasoning(row)));
  const filtered = normalized.filter((row) => row.symbol && row.strategy && (row.why_moving || row.catalyst_headline));
  const highConviction = filtered.filter((row) => isHighConviction(row));
  const selected = (highConviction.length ? highConviction : filtered)
    .slice(0, 8);

  return selected;
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

async function findExistingWindowSend(scheduleWindowKey) {
  const { rows } = await queryWithTimeout(
    `SELECT
       id,
       created_at,
       signals,
       market,
       news,
       stocks_in_play,
       narrative,
       email_status
     FROM morning_briefings
     WHERE as_of_date = CURRENT_DATE
       AND COALESCE(email_status->>'sent', 'false') = 'true'
       AND COALESCE(email_status->>'scheduleWindowKey', '') = $1
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1`,
    [scheduleWindowKey],
    { timeoutMs: 6000, label: 'engines.morning_brief.idempotency_lookup', maxRetries: 0 }
  );
  return rows?.[0] || null;
}

async function enrichSignalsWithNarratives(signals = []) {
  const top = Array.isArray(signals) ? signals.slice(0, 5) : [];
  const enriched = await Promise.all(top.map(async (row) => {
    try {
      const generated = await generateSignalStrengthNarrative({
        symbol: row.symbol,
        strategy: row.strategy,
        score: row.score,
        probability: row.probability,
        catalyst_headline: row.catalyst_headline,
        rvol: row.rvol,
        gap_percent: row.gap_percent,
      });

      return {
        ...row,
        narrative: String(generated || '').trim() || row.setup_reasoning,
      };
    } catch (_error) {
      return {
        ...row,
        narrative: row.setup_reasoning,
      };
    }
  }));

  return [...enriched, ...(signals || []).slice(5)];
}

async function runMorningBriefEngine(options = {}) {
  const startedAt = Date.now();
  await ensureMorningBriefingsTable();

  const shouldEmail = options.sendEmail !== false;
  const scheduleWindowKey = getScheduleWindowKey(options);
  const recipientOverride = options.recipientOverride || null;

  if (shouldEmail && !recipientOverride && !options.forceRun) {
    const existing = await findExistingWindowSend(scheduleWindowKey).catch(() => null);
    if (existing) {
      logger.info('[MORNING_BRIEF] idempotent skip', {
        id: existing.id,
        scheduleWindowKey,
      });

      return {
        id: existing.id,
        createdAt: existing.created_at,
        signals: Array.isArray(existing.signals) ? existing.signals : [],
        market: Array.isArray(existing.market) ? existing.market : [],
        news: Array.isArray(existing.news) ? existing.news : [],
        stocksInPlay: Array.isArray(existing.stocks_in_play) ? existing.stocks_in_play : [],
        narrative: existing.narrative || {},
        emailStatus: {
          ...(existing.email_status || {}),
          skipped: true,
          reason: 'idempotent_window_already_sent',
          scheduleWindowKey,
        },
        runtimeMs: Date.now() - startedAt,
      };
    }
  }

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

  const enhancedSignals = await enrichSignalsWithNarratives(signals);

  const context = {
    signals: enhancedSignals,
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
  const mcpEnhancementStatus = narrative?._meta?.source || 'unknown';

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
      JSON.stringify(enhancedSignals),
      JSON.stringify(market),
      JSON.stringify(news),
      JSON.stringify(stocksInPlay),
      JSON.stringify(narrative),
      JSON.stringify({ sent: false, state: 'pending', scheduleWindowKey, mcpEnhancementStatus }),
    ],
    { timeoutMs: 9000, label: 'engines.morning_brief.insert', maxRetries: 0 }
  );

  const record = insertResult.rows[0] || {};
  const briefing = {
    id: record.id,
    createdAt: record.created_at || new Date().toISOString(),
    signals: enhancedSignals,
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
  if (shouldEmail) {
    try {
      emailStatus = await sendBriefingEmail(briefing, recipientOverride, {
        emailType: EMAIL_TYPES.MORNING_BEACON_BRIEF,
      });
    } catch (error) {
      emailStatus = { sent: false, reason: 'send_failed', detail: error.message };
      logger.error('[MORNING_BRIEF] email send failed', { message: error.message });
    }
  }

  const persistedEmailStatus = {
    ...emailStatus,
    scheduleWindowKey,
    mcpEnhancementStatus,
    recipientsCount: Array.isArray(emailStatus?.recipients) ? emailStatus.recipients.length : 0,
  };

  await queryWithTimeout(
    `UPDATE morning_briefings
     SET email_status = $1::jsonb
     WHERE id = $2`,
    [JSON.stringify(persistedEmailStatus), briefing.id],
    { timeoutMs: 5000, label: 'engines.morning_brief.update_email_status', maxRetries: 0 }
  );

  if (shouldEmail) {
    await recordNewsletterSendHistory({
      subject: `OpenRange Beacon Morning Brief | ${getNyDateKey()}`,
      campaignType: 'morning_brief',
      campaignKey: scheduleWindowKey,
      audience: EMAIL_TYPES.MORNING_BEACON_BRIEF,
      recipientsCount: persistedEmailStatus.recipientsCount,
      providerId: persistedEmailStatus.providerId || null,
      status: persistedEmailStatus.sent ? 'sent' : 'failed',
      metadata: {
        briefId: briefing.id,
        mcpEnhancementStatus,
        topSymbols: enhancedSignals.slice(0, 5).map((row) => row.symbol),
      },
    }).catch((error) => {
      logger.warn('[MORNING_BRIEF] send-history record failed', { message: error.message });
    });
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('[MORNING_BRIEF] completed', {
    id: briefing.id,
    signals: enhancedSignals.length,
    market: market.length,
    news: news.length,
    stocksInPlay: stocksInPlay.length,
    emailSent: Boolean(persistedEmailStatus.sent),
    scheduleWindowKey,
    runtimeMs,
  });

  return {
    ...briefing,
    emailStatus: persistedEmailStatus,
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
