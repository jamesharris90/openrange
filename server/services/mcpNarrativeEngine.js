'use strict';

/**
 * MCP Narrative Engine — Batch Mode
 *
 * Fetches all data in 5 parallel batch queries, processes symbols in memory,
 * then writes results in a single batch INSERT to opportunity_stream.
 *
 * Output shape per symbol: { symbol, why, tradeability, plan, confidence }
 */

const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');
const { detectCatalystCluster } = require('./newsEnrichmentEngine');
const {
  buildPerformanceNote,
  adjustConfidenceByPerformance,
} = require('./signalEvaluationEngine');
const { getCurrentRegime, buildRegimeNarrative, regimeLabel } = require('./marketRegimeEngine');
const { scoreSignal } = require('./tradeSelectionEngine');

// ─── helpers ─────────────────────────────────────────────────────────────────

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ─── batch DB fetch (5 queries, run once for all symbols) ────────────────────

async function fetchBatchData(symbols) {
  const t0 = Date.now();

  const [metricsRows, quotesRows, intradayRows, newsRows, earningsRows, baselineRows, macroRows, reactionRows] = await Promise.all([

    // 1a. Market metrics (price, change_percent, rvol, avg_volume — frequently written but short locks)
    queryWithTimeout(`
      SELECT symbol, price, change_percent, relative_volume, avg_volume_30d, volume
      FROM market_metrics
      WHERE symbol = ANY($1)
    `, [symbols], { timeoutMs: 20000, label: 'narrative.batch.metrics', maxRetries: 0 }),

    // 1b. Market cap from quotes — independent so a lock on quotes doesn't block metrics
    queryWithTimeout(`
      SELECT symbol, market_cap, price AS quotes_price, change_percent AS quotes_change_percent
      FROM market_quotes
      WHERE symbol = ANY($1)
    `, [symbols], { timeoutMs: 20000, label: 'narrative.batch.quotes', maxRetries: 0 }),

    // 2. Latest intraday candle per symbol — lateral index scan, one seek per symbol
    queryWithTimeout(`
      SELECT s.symbol, i."timestamp", i.high, i.low, i.close, i.volume
      FROM unnest($1::text[]) AS s(symbol)
      CROSS JOIN LATERAL (
        SELECT "timestamp", high, low, close, volume
        FROM intraday_1m
        WHERE symbol = s.symbol
        ORDER BY "timestamp" DESC
        LIMIT 1
      ) i
    `, [symbols], { timeoutMs: 20000, label: 'narrative.batch.intraday', maxRetries: 0 }),

    // 3. Enriched news last 48h — includes priority_score + catalyst_cluster
    //    Uses detected_symbols (broader match) falling back to symbols column
    queryWithTimeout(`
      SELECT headline, summary, published_at, catalyst_type, news_score,
             COALESCE(priority_score, 0)  AS priority_score,
             COALESCE(source_type, 'OTHER') AS source_type,
             catalyst_cluster,
             COALESCE(detected_symbols, symbols) AS symbols
      FROM news_articles
      WHERE published_at > NOW() - INTERVAL '48 hours'
        AND (
          COALESCE(detected_symbols, symbols) && $1::text[]
          OR symbols && $1::text[]
        )
      ORDER BY priority_score DESC, published_at DESC
      LIMIT 500
    `, [symbols], { timeoutMs: 15000, label: 'narrative.batch.news', maxRetries: 0 }),

    // 4. Next upcoming earnings per symbol — earnings_events only (earnings_calendar may not exist)
    queryWithTimeout(`
      SELECT DISTINCT ON (symbol) symbol, report_date AS event_date
      FROM earnings_events
      WHERE symbol = ANY($1)
        AND report_date >= CURRENT_DATE
      ORDER BY symbol, report_date ASC
    `, [symbols], { timeoutMs: 15000, label: 'narrative.batch.earnings', maxRetries: 0 }),

    // 5. Pre-computed baseline cache — populated by baselineEngine every 30 min
    queryWithTimeout(`
      SELECT symbol, avg_move AS avg_daily_move_pct, avg_rvol AS avg_daily_rvol
      FROM symbol_baselines
      WHERE symbol = ANY($1)
    `, [symbols], { timeoutMs: 10000, label: 'narrative.batch.baseline', maxRetries: 0 }),

    // 6. Upcoming macro events in next 5 days (market-wide, not per-symbol)
    queryWithTimeout(`
      SELECT event_type, event_date, expected_value, previous_value, importance
      FROM macro_events
      WHERE event_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '5 days'
      ORDER BY importance DESC, event_date ASC
    `, [], { timeoutMs: 8000, label: 'narrative.batch.macro', maxRetries: 0 }),

    // 7. Historical symbol reactions to macro event types (empty table is fine)
    queryWithTimeout(`
      SELECT symbol, event_type, avg_move_pct, sample_size
      FROM macro_reactions
      WHERE symbol = ANY($1)
    `, [symbols], { timeoutMs: 8000, label: 'narrative.batch.reactions', maxRetries: 0 }),

  ]);

  const durationMs = Date.now() - t0;
  console.log(`[MCP BATCH] symbols=${symbols.length} queries=8 duration_ms=${durationMs}`);

  return { metricsRows, quotesRows, intradayRows, newsRows, earningsRows, baselineRows, macroRows, reactionRows };
}

// ─── build lookup maps ────────────────────────────────────────────────────────

function buildLookupMaps({ metricsRows, quotesRows, intradayRows, newsRows, earningsRows, baselineRows, macroRows, reactionRows }) {
  const quotesMap    = {};
  const intradayMap  = {};
  const newsMap      = {};
  const earningsMap  = {};
  const baselineMap  = {};
  const reactionMap  = {};  // keyed: symbol -> { event_type -> row }

  // Merge metrics + quotes into a single market entry per symbol
  for (const row of metricsRows.rows) quotesMap[row.symbol] = { ...row };
  for (const row of quotesRows.rows) {
    if (quotesMap[row.symbol]) {
      quotesMap[row.symbol].market_cap       = row.market_cap;
      // Prefer quotes price/change if metrics is missing them
      quotesMap[row.symbol].quotes_price     = row.quotes_price;
      quotesMap[row.symbol].quotes_change    = row.quotes_change_percent;
    } else {
      quotesMap[row.symbol] = { symbol: row.symbol, market_cap: row.market_cap, price: row.quotes_price, change_percent: row.quotes_change_percent };
    }
  }

  for (const row of intradayRows.rows) intradayMap[row.symbol] = row;
  for (const row of earningsRows.rows) earningsMap[row.symbol] = row;
  for (const row of baselineRows.rows) baselineMap[row.symbol] = row;

  // Distribute news articles to each symbol they mention
  for (const article of newsRows.rows) {
    const mentioned = Array.isArray(article.symbols) ? article.symbols : [];
    for (const sym of mentioned) {
      if (!newsMap[sym]) newsMap[sym] = [];
      newsMap[sym].push(article);
    }
  }

  // Macro events are market-wide — stored as sorted array, not keyed by symbol
  const macroEvents = macroRows.rows || [];

  // Reaction history keyed: symbol -> { event_type -> row }
  for (const row of reactionRows.rows) {
    if (!reactionMap[row.symbol]) reactionMap[row.symbol] = {};
    reactionMap[row.symbol][row.event_type] = row;
  }

  return { quotesMap, intradayMap, newsMap, earningsMap, baselineMap, macroEvents, reactionMap };
}

// ─── assemble per-symbol context from maps (no DB calls) ─────────────────────

function assembleContext(symbol, { quotesMap, intradayMap, newsMap, earningsMap, baselineMap, macroEvents, reactionMap }) {
  const market    = quotesMap[symbol]    || null;
  const candle    = intradayMap[symbol]  || null;
  const news      = newsMap[symbol]      || [];
  const earnings  = earningsMap[symbol]  || null;
  const baseline  = baselineMap[symbol]  || null;
  const reactions = reactionMap[symbol]  || {};

  const rawPrice         = toNum(market?.price ?? candle?.close);
  const rawChangePercent = toNum(market?.change_percent);
  const rawRelativeVol   = toNum(market?.relative_volume);

  let daysToEarnings = null;
  if (earnings?.event_date) {
    const diff = new Date(earnings.event_date) - new Date();
    daysToEarnings = Math.ceil(diff / 86400000);
  }

  // High-quality news: articles with priority_score >= 2 or the best available
  const qualityNews    = news.filter(a => Number(a.priority_score ?? 0) >= 2);
  const hasQualityNews = qualityNews.length > 0;

  // Catalyst cluster: dominant theme from enriched articles
  const newsCluster = detectCatalystCluster(news);

  // Top article: highest priority_score, falling back to most-recent
  const topNews = qualityNews[0] || news[0] || null;

  return {
    symbol,
    price:              rawPrice,
    change_percent:     rawChangePercent,
    relative_volume:    rawRelativeVol,
    avg_volume_30d:     toNum(market?.avg_volume_30d),
    market_cap:         toNum(market?.market_cap),
    intraday_high:      toNum(candle?.high),
    intraday_low:       toNum(candle?.low),
    intraday_close:     toNum(candle?.close),
    intraday_ts:        candle?.timestamp || null,
    news_count:         news.length,
    quality_news_count: qualityNews.length,
    has_quality_news:   hasQualityNews,
    latest_news:        topNews,
    news_cluster:       newsCluster,
    _quality_news:      qualityNews,   // passed to interpretCatalyst for multi-article sentiment
    earnings_date:      earnings?.event_date || null,
    days_to_earnings:   daysToEarnings,
    avg_daily_move_pct: toNum(baseline?.avg_daily_move_pct, null),
    avg_daily_rvol:     toNum(baseline?.avg_daily_rvol, null),
    // Macro context — nearest high-importance event within 5 days (market-wide)
    macro_event:        macroEvents.find(e => e.importance === 'HIGH') || macroEvents[0] || null,
    macro_reactions:    reactions,
    data_warnings:      [],
  };
}

// ─── data sanity filter ───────────────────────────────────────────────────────

function sanitizeContext(ctx) {
  const { symbol } = ctx;
  const warnings = [];

  let price         = ctx.price;
  let changePercent = ctx.change_percent;
  let relativeVol   = ctx.relative_volume;

  if (!Number.isFinite(price) || price <= 0) {
    warnings.push('INVALID_PRICE');
    console.warn('[DATA SANITY]', symbol, 'INVALID_PRICE: price=' + price);
    price = 0;
  }

  if (!Number.isFinite(changePercent) || changePercent > 50 || changePercent < -50) {
    warnings.push('INVALID_CHANGE');
    console.warn('[DATA SANITY]', symbol, 'INVALID_CHANGE: change_percent=' + changePercent);
    changePercent = 0;
  }

  if (!Number.isFinite(relativeVol) || relativeVol <= 0) {
    warnings.push('INVALID_RVOL');
    console.warn('[DATA SANITY]', symbol, 'INVALID_RVOL: relative_volume=' + relativeVol);
    relativeVol = 1;
  }

  return { ...ctx, price, change_percent: changePercent, relative_volume: relativeVol, data_warnings: warnings };
}

// ─── condition flags ──────────────────────────────────────────────────────────

function detectConditions(ctx) {
  const absMove = Math.abs(ctx.change_percent);

  const hasBaseline   = ctx.avg_daily_rvol !== null && ctx.avg_daily_move_pct !== null;
  const unusualVolume = hasBaseline && ctx.avg_daily_rvol > 0
    && ctx.relative_volume > ctx.avg_daily_rvol * 1.5;
  const unusualMove   = hasBaseline && ctx.avg_daily_move_pct > 0
    && absMove > ctx.avg_daily_move_pct * 2;

  const macroEvent   = ctx.macro_event;
  const macroRisk    = macroEvent !== null && macroEvent.importance === 'HIGH'
    && (() => {
      const diff = new Date(macroEvent.event_date) - new Date();
      return diff >= 0 && diff <= 3 * 86400000;
    })();

  return {
    HIGH_VOLUME:    ctx.relative_volume > 2,
    LOW_VOLUME:     ctx.relative_volume > 0 && ctx.relative_volume < 1,
    STRONG_MOVE:    absMove > 3,
    NO_MOVE:        absMove < 1,
    NEWS_PRESENT:   ctx.news_count > 0,
    QUALITY_NEWS:   ctx.has_quality_news === true,
    NEWS_CLUSTERED: ctx.news_cluster !== null && ctx.news_cluster !== undefined,
    EARNINGS_NEAR:  ctx.days_to_earnings !== null && ctx.days_to_earnings >= 0 && ctx.days_to_earnings <= 7,
    LARGE_CAP:      ctx.market_cap > 1_000_000_000,
    UNUSUAL_VOLUME: unusualVolume,
    UNUSUAL_MOVE:   unusualMove,
    MACRO_RISK:     macroRisk,
  };
}

// ─── setup classification ─────────────────────────────────────────────────────

function detectSetupType(flags) {
  if (flags.UNUSUAL_VOLUME && flags.STRONG_MOVE)  return 'MOMENTUM';
  if (flags.UNUSUAL_VOLUME && !flags.STRONG_MOVE) return 'ACCUMULATION';
  if (flags.UNUSUAL_MOVE   && flags.LOW_VOLUME)   return 'WEAK_MOVE';
  if (flags.NO_MOVE        && flags.LOW_VOLUME)   return 'DEAD';
  if (flags.STRONG_MOVE    && flags.HIGH_VOLUME)  return 'MOMENTUM';
  if (flags.NO_MOVE || flags.LOW_VOLUME)          return 'DEAD';
  return 'NEUTRAL';
}

// ─── catalyst interpretation layer ───────────────────────────────────────────

// Human-readable cluster theme labels (used in both interpretation + fallback)
const CLUSTER_LABELS = {
  EARNINGS: 'earnings',
  FDA:      'FDA/regulatory',
  LEGAL:    'legal pressure',
  MERGER:   'M&A activity',
  ANALYST:  'analyst action',
  OFFERING: 'share offering',
};

// Positive/negative keyword sets for sentiment scoring
const POSITIVE_WORDS = /\b(beat|beats|beat|growth|upgrade|upgraded|strong|record|bullish|raises|raised|surge|outperform|approval|approved|wins|positive|better|higher|profit|gain|expanding)\b/i;
const NEGATIVE_WORDS = /\b(miss|misses|missed|downgrade|downgraded|lawsuit|weak|decline|declined|risk|cut|cuts|warning|loss|lower|drop|drops|fell|negative|worse|disappoints|disappointing|charges|recall|probe|investigation|concern)\b/i;

/**
 * Score a single article headline for directional sentiment.
 * Returns -1, 0, or +1.
 */
function scoreHeadlineSentiment(headline) {
  const text = String(headline || '');
  const pos  = POSITIVE_WORDS.test(text) ? 1 : 0;
  const neg  = NEGATIVE_WORDS.test(text) ? 1 : 0;
  if (pos && !neg) return 1;
  if (neg && !pos) return -1;
  return 0;
}

/**
 * Aggregate cluster sentiment from multiple articles.
 * Returns { score, consensus: 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL', bullCount, bearCount }
 */
function scoreClusterSentiment(articles) {
  let score = 0;
  let bullCount = 0;
  let bearCount = 0;

  for (const a of articles) {
    const s = scoreHeadlineSentiment(a.headline);
    score += s;
    if (s > 0) bullCount++;
    if (s < 0) bearCount++;
  }

  let consensus;
  if      (score > 3)  consensus = 'BULLISH';
  else if (score < -3) consensus = 'BEARISH';
  else if (bullCount > 0 && bearCount > 0) consensus = 'MIXED';
  else    consensus = 'NEUTRAL';

  return { score, consensus, bullCount, bearCount };
}

/**
 * Interpret a catalyst cluster: sentiment + price confirmation → one actionable line.
 *
 * Returns a string of ≤12 words, or null if inputs are insufficient.
 *
 * Price confirmation logic:
 *   BULLISH news + price DOWN      → "Bullish news not being bought — weak reaction"
 *   BEARISH news + price flat/UP   → "Selling pressure absorbed — possible support"
 *   BULLISH news + price UP + vol  → "News confirmed by price action"
 *   BEARISH news + price DOWN+vol  → "Selling confirmed — distribution in progress"
 *   MIXED/NEUTRAL                  → theme-specific mixed phrase
 */
function interpretCatalyst(cluster, ctx) {
  if (!cluster) return null;

  const articles   = cluster.topArticle ? [cluster.topArticle] : [];
  // Use all quality news for sentiment scoring when available
  const allArticles = (ctx.quality_news_count > 0 && ctx._quality_news)
    ? ctx._quality_news
    : articles;

  const sentiment  = scoreClusterSentiment(allArticles.length > 0 ? allArticles : articles);
  const { consensus } = sentiment;
  const theme      = CLUSTER_LABELS[cluster.theme] || cluster.theme.toLowerCase();
  const priceMov   = ctx.change_percent;
  const rvol       = ctx.relative_volume;
  const isUp       = priceMov > 0.5;
  const isDown     = priceMov < -0.5;
  const hasVolume  = rvol > 1.5;

  // ── price confirmation matrix ──────────────────────────────────────────────

  if (consensus === 'BULLISH') {
    if (isDown)             return `${theme} catalyst — bullish news not being bought`;
    if (isUp && hasVolume)  return `${theme} catalyst — confirmed by price and volume`;
    if (isUp)               return `${theme} catalyst — bullish, modest follow-through`;
    return                         `${theme} catalyst — bullish consensus, awaiting move`;
  }

  if (consensus === 'BEARISH') {
    if (isDown && hasVolume) return `${theme} catalyst — confirmed selling pressure`;
    if (isDown)              return `${theme} catalyst — selling but low conviction`;
    if (!isDown)             return `${theme} catalyst — selling absorbed, possible support`;
    return                          `${theme} catalyst — bearish consensus`;
  }

  if (consensus === 'MIXED') {
    if (isDown)  return `${theme} catalyst — mixed reaction, bears in control`;
    if (isUp)    return `${theme} catalyst — mixed reaction, bulls in control`;
    return              `${theme} catalyst — mixed reaction, no clear direction`;
  }

  // NEUTRAL — fall back to pure price confirmation
  if (isDown && hasVolume)  return `${theme} catalyst — confirmed by selling pressure`;
  if (isUp  && hasVolume)   return `${theme} catalyst — confirmed by price action`;
  if (isDown)               return `${theme} catalyst — weak price reaction, bearish`;
  if (isUp)                 return `${theme} catalyst — weak price reaction, bullish`;
  return                           `${theme} catalyst — no price confirmation yet`;
}

// ─── narrative builders ───────────────────────────────────────────────────────

function buildWhy(ctx, flags) {
  const dir = ctx.change_percent >= 0 ? 'up' : 'down';
  const pct = Math.abs(ctx.change_percent).toFixed(2);

  // Priority 1: Interpreted cluster — sentiment + price confirmation
  if (flags.NEWS_CLUSTERED && ctx.news_cluster) {
    const interpreted = interpretCatalyst(ctx.news_cluster, ctx);
    if (interpreted) {
      return `${ctx.symbol} ${dir} ${pct}% — ${interpreted}`;
    }
    // Fallback: raw cluster label if interpretation returns null
    const label = CLUSTER_LABELS[ctx.news_cluster.theme] || ctx.news_cluster.theme.toLowerCase();
    return `${ctx.symbol} ${dir} ${pct}% — ${label} catalyst`;
  }

  // Priority 2: Single high-quality article + price context
  if (flags.QUALITY_NEWS && ctx.latest_news) {
    const s          = scoreHeadlineSentiment(ctx.latest_news.headline);
    const isUp       = ctx.change_percent > 0.5;
    const isDown     = ctx.change_percent < -0.5;
    const hasVolume  = ctx.relative_volume > 1.5;
    let reaction = '';
    if (s > 0  && isDown)              reaction = ' — bullish news not being bought';
    else if (s < 0 && !isDown)         reaction = ' — selling pressure absorbed';
    else if (hasVolume && (isUp || isDown)) reaction = ' — confirmed by price action';
    return `${ctx.symbol} ${dir} ${pct}% — ${ctx.latest_news.headline}${reaction}`;
  }

  // Priority 3: Low-quality / no confirmed catalyst
  if (flags.NEWS_PRESENT && !flags.QUALITY_NEWS) {
    const volNote = flags.UNUSUAL_VOLUME
      ? ` (${ctx.relative_volume.toFixed(1)}x vol)`
      : '';
    return `${ctx.symbol} ${dir} ${pct}%${volNote} — low signal news only`;
  }

  // Priority 4: Earnings proximity
  if (flags.EARNINGS_NEAR) {
    return `${ctx.symbol} ${dir} ${pct}% — earnings in ${ctx.days_to_earnings}d`;
  }

  // Priority 5: Volume / move without catalyst
  if (flags.UNUSUAL_VOLUME) {
    return `${ctx.symbol} ${dir} ${pct}% — unusual volume, no catalyst (${ctx.relative_volume.toFixed(1)}x avg)`;
  }
  if (flags.UNUSUAL_MOVE) {
    return `${ctx.symbol} ${dir} ${pct}% — move exceeds typical range, no news`;
  }
  if (flags.HIGH_VOLUME) {
    return `${ctx.symbol} ${dir} ${pct}% — volume expanding, no catalyst`;
  }

  // Priority 6: Drift
  if (flags.NO_MOVE) {
    return `${ctx.symbol} flat — drifting without catalyst`;
  }
  return `${ctx.symbol} ${dir} ${pct}% — no clear catalyst`;
}

function buildTradeability(ctx, flags) {
  if (flags.LOW_VOLUME)                   return 'Low liquidity — not ideal';
  if (flags.NO_MOVE)                      return 'No meaningful movement — low opportunity';
  if (flags.HIGH_VOLUME && flags.LARGE_CAP) return 'High liquidity — in play';
  if (flags.HIGH_VOLUME)                  return 'High volume but thin float — elevated risk, size down';
  if (flags.STRONG_MOVE)                  return 'Strong move — monitor for entry structure';
  return 'Moderate conditions — wait for confirmation';
}

function buildPlan(ctx, flags) {
  const setup = detectSetupType(flags);
  const high  = ctx.intraday_high > 0 ? ctx.intraday_high.toFixed(2) : null;
  const low   = ctx.intraday_low  > 0 ? ctx.intraday_low.toFixed(2)  : null;

  if (setup === 'MOMENTUM') {
    return high
      ? `Momentum setup — continuation likely. Watch break above ${high}`
      : 'Momentum setup — continuation likely if volume sustains';
  }
  if (setup === 'ACCUMULATION') {
    return high
      ? `Accumulation — breakout possible. Watch range high ${high}`
      : 'Accumulation — building pressure, watch for range break';
  }
  if (setup === 'WEAK_MOVE') {
    return low
      ? `Move lacks volume — likely to fade. Watch break below ${low}`
      : 'Move lacks volume — likely to fade';
  }
  if (setup === 'DEAD') {
    return 'No participation — avoid trading';
  }
  if (flags.EARNINGS_NEAR) {
    return 'Earnings play — define max risk before entry; avoid holding through print without hedge';
  }
  return 'No clear edge — wait for better setup';
}

function buildConfidence(flags) {
  let score = 50;
  if (flags.HIGH_VOLUME)     score += 20;
  if (flags.NEWS_PRESENT)    score += 15;
  if (flags.EARNINGS_NEAR)   score += 10;
  if (flags.UNUSUAL_MOVE)    score += 10;
  if (flags.LOW_VOLUME)      score -= 20;
  if (flags.NO_MOVE)         score -= 10;
  const setup = detectSetupType(flags);
  if (setup === 'MOMENTUM')  score += 10;
  if (setup === 'WEAK_MOVE') score -= 10;
  return clamp(score, 0, 100);
}

// ─── macro impact scoring ─────────────────────────────────────────────────────

/**
 * Returns quantified macro impact for a symbol given the nearest macro event.
 * Uses historical macro_reactions for the symbol + event type to derive an
 * expected impact percent, then compares to the symbol's typical daily move.
 *
 * Returns null if no macro event is present.
 *
 * Shape: { eventLabel, daysUntil, impactPct, expectedMovePct, impactRatio, impactClass }
 */
function scoreMacroImpact(ctx) {
  const macroEvent = ctx.macro_event;
  if (!macroEvent) return null;

  const eventLabel = macroEvent.event_type;
  const reactions  = ctx.macro_reactions || {};

  // Days until event (calendar, clamped to 0 if in the past)
  const diffMs    = new Date(macroEvent.event_date) - new Date();
  const daysUntil = Math.max(0, Math.ceil(diffMs / 86400000));

  // Historical impact for this symbol on this event type
  const reaction    = reactions[eventLabel];
  const hasReaction = reaction && reaction.sample_size >= 3
                   && reaction.avg_move_pct !== null;
  const impactPct   = hasReaction ? Math.abs(Number(reaction.avg_move_pct)) : null;

  // Expected move baseline: 5-day avg daily move from symbol_baselines
  const expectedMovePct = ctx.avg_daily_move_pct && ctx.avg_daily_move_pct > 0
    ? ctx.avg_daily_move_pct
    : null;

  // Compute ratio only when both numbers are available and valid
  let impactRatio  = null;
  let impactClass  = null;

  if (impactPct !== null && expectedMovePct !== null && expectedMovePct > 0) {
    impactRatio = impactPct / expectedMovePct;
    if (impactRatio > 0.5)                        impactClass = 'HIGH';
    else if (impactRatio >= 0.2)                  impactClass = 'MEDIUM';
    else                                          impactClass = 'LOW';
  }

  return {
    eventLabel,
    daysUntil,
    impactPct,
    expectedMovePct,
    impactRatio,
    impactClass,
    sampleSize: hasReaction ? reaction.sample_size : 0,
  };
}

function buildOutlook(ctx, flags) {
  const macroEvent = ctx.macro_event;

  // ── Non-macro fallbacks ────────────────────────────────────────────────────
  if (!flags.MACRO_RISK || !macroEvent) {
    if (flags.EARNINGS_NEAR) {
      return `Earnings in ${ctx.days_to_earnings} day${ctx.days_to_earnings === 1 ? '' : 's'} — volatility may increase into the print`;
    }
    const setup = detectSetupType(flags);
    if (setup === 'MOMENTUM') {
      return 'Momentum conditions present — trend continuation likely while volume sustains';
    }
    if (flags.NO_MOVE && flags.LOW_VOLUME) {
      return 'No catalyst in view — price likely to drift until a trigger emerges';
    }
    return null;
  }

  // ── Macro scoring ──────────────────────────────────────────────────────────
  const score = scoreMacroImpact(ctx);
  const setup = detectSetupType(flags);

  // Line 1: event header
  const dayLabel = score.daysUntil === 0 ? 'today'
    : score.daysUntil === 1 ? 'in 1 day'
    : `in ${score.daysUntil} days`;
  const header = `Macro: ${score.eventLabel} ${dayLabel}`;

  // Line 2: impact class
  let impactLine;
  if (score.impactClass === 'HIGH') {
    impactLine = 'Expected impact: HIGH — likely to drive move exceeding typical daily range';
  } else if (score.impactClass === 'MEDIUM') {
    impactLine = 'Expected impact: MEDIUM — may influence price action';
  } else if (score.impactClass === 'LOW') {
    impactLine = 'Expected impact: LOW — macro impact likely muted vs current volatility';
  } else {
    // No historical data — can still note the event but can't quantify
    impactLine = 'Expected impact: UNKNOWN — no historical reaction data';
  }

  // Line 3: volatility context (only when we have both numbers)
  let volatilityLine = null;
  if (score.impactPct !== null && score.expectedMovePct !== null) {
    const n = score.sampleSize > 0 ? ` (n=${score.sampleSize})` : '';
    volatilityLine = `Volatility context: ±${score.impactPct.toFixed(1)}% historical${n} vs ~${score.expectedMovePct.toFixed(1)}% typical daily`;
  }

  // Line 4: directional bias
  const isBearish = ctx.change_percent < -1 || setup === 'WEAK_MOVE';
  const isBullish = ctx.change_percent > 1  || setup === 'MOMENTUM' || setup === 'ACCUMULATION';
  let biasSuffix;
  if (score.impactClass === 'LOW') {
    biasSuffix = '→ Limited directional edge';
  } else if (isBearish) {
    biasSuffix = '→ Downside risk increases into event';
  } else if (isBullish) {
    biasSuffix = '→ Upside continuation depends on data outcome';
  } else {
    biasSuffix = '→ Directional bias unclear until print';
  }

  const lines = [header, impactLine];
  if (volatilityLine) lines.push(volatilityLine);
  lines.push(biasSuffix);

  return lines.join('\n');
}

// ─── trade consequence layer (deterministic, no LLM) ─────────────────────────

/**
 * Classifies market state and edge type, returns one actionable consequence line.
 *
 * Market states:
 *   DEAD     — abs_change < 0.5 AND rvol < 1
 *   EXTENDED — abs_change > avg_move * 2 AND rvol > 1.5
 *   ACTIVE   — abs_change > avg_move AND rvol > 1.5
 *   RANGE    — all other cases
 *
 * Edge cases:
 *   CONTINUATION — news + price + volume all aligned
 *   FAILED_MOVE  — bullish news, price down
 *   ABSORPTION   — bearish news, price up
 *   NO_EDGE      — mixed/no signal, low volume
 *
 * Overrides:
 *   confidence < 40 → "Low conviction — reduced size or avoid"
 *   EXTENDED        → append "— extended move, avoid chasing"
 */
function buildConsequence(ctx, flags, confidence) {
  const absMove = Math.abs(ctx.change_percent);
  const avgMove = ctx.avg_daily_move_pct && ctx.avg_daily_move_pct > 0
    ? ctx.avg_daily_move_pct : null;
  const rvol = ctx.relative_volume;

  // ── Market state ────────────────────────────────────────────────────────────
  let marketState;
  if (absMove < 0.5 && rvol < 1) {
    marketState = 'DEAD';
  } else if (avgMove && absMove > avgMove * 2 && rvol > 1.5) {
    marketState = 'EXTENDED';
  } else if (avgMove && absMove > avgMove && rvol > 1.5) {
    marketState = 'ACTIVE';
  } else {
    marketState = 'RANGE';
  }

  if (marketState === 'DEAD') {
    return 'No edge — market inactive, avoid trading';
  }

  // ── News bias from cluster + quality articles ─────────────────────────────
  let newsBias = null;
  if (ctx.news_cluster) {
    const articles = (ctx._quality_news && ctx._quality_news.length > 0)
      ? ctx._quality_news
      : (ctx.news_cluster.topArticle ? [ctx.news_cluster.topArticle] : []);
    if (articles.length > 0) {
      const sentiment = scoreClusterSentiment(articles);
      if (sentiment.consensus !== 'NEUTRAL') newsBias = sentiment.consensus;
    }
  }

  const isUp      = ctx.change_percent > 0.5;
  const isDown    = ctx.change_percent < -0.5;
  const hasVolume = rvol > 1.5;

  let consequence;

  if (newsBias === 'BULLISH') {
    if (isUp && hasVolume)  consequence = 'Continuation long — confirmed momentum';
    else if (isDown)        consequence = 'Short bias — failed bullish catalyst';
    else if (isUp)          consequence = 'Long bias — bullish catalyst with follow-through';
    else                    consequence = 'Long bias — bullish catalyst, awaiting price confirmation';
  } else if (newsBias === 'BEARISH') {
    if (isDown && hasVolume) consequence = 'Short bias — bearish catalyst confirmed';
    else if (!isDown)        consequence = 'Long bias — selling absorbed, possible support';
    else                     consequence = 'Short bias — bearish catalyst, low conviction';
  } else if (newsBias === 'MIXED') {
    if (isDown)   consequence = 'Range-bound — mixed catalyst, bears in control';
    else if (isUp) consequence = 'Range-bound — mixed catalyst, bulls in control';
    else           consequence = 'No edge — mixed catalyst, no clear direction';
  } else {
    // No news bias — pure price/volume
    if (isUp  && hasVolume)    consequence = 'Long bias — price and volume aligned, no catalyst';
    else if (isDown && hasVolume) consequence = 'Short bias — selling pressure, no news catalyst';
    else if (flags.UNUSUAL_MOVE)  consequence = 'Range-bound — unusual move without catalyst';
    else                          consequence = 'No edge — avoid until breakout';
  }

  // ── Overrides ────────────────────────────────────────────────────────────────
  if (confidence < 40) {
    return 'Low conviction — reduced size or avoid';
  }

  if (marketState === 'EXTENDED') {
    consequence = consequence + ' — extended move, avoid chasing';
  }

  return consequence;
}

// ─── per-symbol narrative (pure, works on assembled context) ──────────────────

function computeNarrative(ctx) {
  if (ctx.data_warnings.length > 0) {
    const regime = getCurrentRegime();
    return {
      symbol:            ctx.symbol,
      why:               'Price data inconsistent — no reliable move detected',
      tradeability:      'Data unreliable — avoid trading',
      plan:              'Wait for stable pricing before trading',
      confidence:        0,
      outlook:           null,
      consequence:       null,
      performance_note:  null,
      regime_context:    regimeLabel(regime),
      trade_score:       0,
      regime_alignment:  'NEUTRAL',
      entry_price:       0,
      setup_type:        'DEAD',
      catalyst_cluster:  null,
      expected_move_pct: null,
      regime_trend:      regime?.trend       || null,
      regime_volatility: regime?.volatility  || null,
      regime_session:    regime?.session_type || null,
    };
  }

  const flags      = detectConditions(ctx);
  const setup_type = detectSetupType(flags);

  // Current market regime (sync read from in-process cache)
  const regime = getCurrentRegime();

  // Base confidence from real-time market conditions
  const baseConfidence = buildConfidence(flags);

  // Consequence uses base confidence for the "Low conviction" override
  const consequence = buildConsequence(ctx, flags, baseConfidence);

  // Regime-aware confidence adjustment (falls back to global if regime unknown)
  const confidence = adjustConfidenceByPerformance(
    baseConfidence, setup_type, consequence,
    regime?.trend, regime?.volatility
  );

  // Outlook: existing macro/earnings logic + regime narrative appended
  const rawOutlook   = buildOutlook(ctx, flags);
  const regimeNote   = buildRegimeNarrative(regime);
  const outlook      = rawOutlook
    ? (regimeNote ? rawOutlook + '\n' + regimeNote : rawOutlook)
    : regimeNote || null;

  // Performance note (null until ≥10 evaluated signals for this pattern)
  const catalyst_cluster = ctx.news_cluster?.theme || null;
  const performance_note = buildPerformanceNote(setup_type, consequence, regime);

  // Composite trade score (persisted for pre-sort; recomputed live in top-focus)
  const { trade_score, regime_alignment } = scoreSignal({
    confidence,
    consequence,
    setup_type,
    relative_volume: ctx.relative_volume,
    market_cap:      ctx.market_cap,
  }, regime);

  return {
    symbol:            ctx.symbol,
    why:               buildWhy(ctx, flags),
    tradeability:      buildTradeability(ctx, flags),
    plan:              buildPlan(ctx, flags),
    confidence,
    outlook,
    consequence,
    performance_note,
    regime_context:    regimeLabel(regime),
    trade_score,
    regime_alignment,
    // Fields for signal_outcomes logging — not written to opportunity_stream
    entry_price:       ctx.price,
    setup_type,
    catalyst_cluster,
    expected_move_pct: ctx.avg_daily_move_pct || null,
    regime_trend:      regime?.trend       || null,
    regime_volatility: regime?.volatility  || null,
    regime_session:    regime?.session_type || null,
  };
}

// ─── batch DB writer ──────────────────────────────────────────────────────────

async function batchWriteToOpportunityStream(narratives) {
  if (narratives.length === 0) return;

  // Build a json_to_recordset insert so it's one round-trip
  const sql = `
    INSERT INTO opportunity_stream
      (symbol, event_type, headline, score, source, why, tradeability, plan,
       confidence, outlook, consequence, performance_note,
       regime_context, trade_score, regime_alignment, updated_at)
    SELECT
      r.symbol, 'narrative', r.why, r.confidence,
      'mcp_narrative_engine', r.why, r.tradeability, r.plan,
      r.confidence, r.outlook, r.consequence, r.performance_note,
      r.regime_context, r.trade_score::numeric, r.regime_alignment, NOW()
    FROM json_to_recordset($1::json) AS r(
      symbol           text,
      why              text,
      tradeability     text,
      plan             text,
      confidence       int,
      outlook          text,
      consequence      text,
      performance_note text,
      regime_context   text,
      trade_score      text,
      regime_alignment text
    )
  `;

  await queryWithTimeout(
    sql,
    [JSON.stringify(narratives)],
    { timeoutMs: 15000, label: 'narrative.batch.write', maxRetries: 0 }
  );

  // Fire-and-forget: log to signal_outcomes for later evaluation
  batchLogSignals(narratives).catch((err) =>
    logger.warn('[NARRATIVE] signal logging failed', { error: err.message })
  );
}

// ─── signal outcome logger ────────────────────────────────────────────────────

function toTradeClass(confidence) {
  if (confidence >= 80) return 'A';
  if (confidence >= 60) return 'B';
  if (confidence >= 40) return 'C';
  return 'D';
}

async function batchLogSignals(narratives) {
  // Only log signals with valid prices
  const loggable = narratives.filter((n) => Number(n.entry_price) > 0);
  if (loggable.length === 0) return;

  const payload = loggable.map((n) => ({
    symbol:            n.symbol,
    setup_type:        n.setup_type        || null,
    trade_class:       toTradeClass(n.confidence),
    consequence:       n.consequence       || null,
    catalyst_cluster:  n.catalyst_cluster  || null,
    entry_price:       String(Number(n.entry_price).toFixed(4)),
    expected_move_pct: n.expected_move_pct != null
      ? String(Number(n.expected_move_pct).toFixed(4))
      : null,
    regime_trend:      n.regime_trend      || null,
    regime_volatility: n.regime_volatility || null,
    regime_session:    n.regime_session    || null,
  }));

  const sql = `
    INSERT INTO signal_outcomes
      (symbol, signal_ts, setup_type, trade_class, consequence,
       catalyst_cluster, entry_price, expected_move_pct,
       regime_trend, regime_volatility, regime_session)
    SELECT
      r.symbol, NOW(), r.setup_type, r.trade_class, r.consequence,
      r.catalyst_cluster, r.entry_price::numeric, r.expected_move_pct::numeric,
      r.regime_trend, r.regime_volatility, r.regime_session
    FROM json_to_recordset($1::json) AS r(
      symbol            text,
      setup_type        text,
      trade_class       text,
      consequence       text,
      catalyst_cluster  text,
      entry_price       text,
      expected_move_pct text,
      regime_trend      text,
      regime_volatility text,
      regime_session    text
    )
    WHERE r.entry_price::numeric > 0
  `;

  await queryWithTimeout(sql, [JSON.stringify(payload)], {
    timeoutMs: 15000,
    label:     'narrative.signal_log',
    maxRetries: 0,
  });
}

// ─── main engine (batch mode) ─────────────────────────────────────────────────

async function runNarrativeEngine(symbols = []) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    const r = await queryWithTimeout(
      `SELECT symbol FROM market_metrics
       WHERE ABS(COALESCE(change_percent, 0)) > 0.5
         AND updated_at > NOW() - INTERVAL '2 hours'
       ORDER BY ABS(COALESCE(change_percent, 0)) DESC
       LIMIT 50`,
      [],
      { timeoutMs: 20000, label: 'narrative.active_symbols', maxRetries: 0 }
    );
    symbols = r.rows.map((row) => row.symbol);
  }

  if (symbols.length === 0) {
    logger.info('[NARRATIVE] no active symbols — skipped');
    return { processed: 0, skipped: true };
  }

  logger.info(`[NARRATIVE] processing ${symbols.length} symbols`);
  const t0 = Date.now();

  // Single batch fetch for all symbols
  const batchData = await fetchBatchData(symbols);
  const maps      = buildLookupMaps(batchData);

  // Process all symbols in memory
  const narratives = [];
  for (const symbol of symbols) {
    try {
      const raw = assembleContext(symbol, maps);
      const ctx = sanitizeContext(raw);
      const narrative = computeNarrative(ctx);
      narratives.push(narrative);

      logger.info('[NARRATIVE]', {
        symbol:     narrative.symbol,
        confidence: narrative.confidence,
        why:        narrative.why,
      });
    } catch (err) {
      logger.error('[NARRATIVE] symbol failed', { symbol, error: err.message });
    }
  }

  // Single batch write
  await batchWriteToOpportunityStream(narratives);

  const durationMs = Date.now() - t0;
  logger.info(`[NARRATIVE] done — processed=${narratives.length} duration_ms=${durationMs}`);
  return { processed: narratives.length, failures: symbols.length - narratives.length };
}

// ─── compat: single-symbol entry point (wraps batch engine) ──────────────────

async function buildNarrative(symbol) {
  const result = await runNarrativeEngine([symbol]);
  return result;
}

// ─── backward-compat export (for existing index.js import) ───────────────────

function generateNarrative(signal = {}) {
  const symbol        = String(signal.symbol || '').toUpperCase();
  const changePercent = toNum(signal.change_percent);
  const rvol          = toNum(signal.relative_volume ?? signal.rvol);
  const newsCount     = toNum(signal.news_count);
  const catalystType  = String(signal.catalyst_type || '').toUpperCase();
  const marketCap     = toNum(signal.market_cap);

  const flags = {
    HIGH_VOLUME:    rvol > 2,
    LOW_VOLUME:     rvol > 0 && rvol < 1,
    STRONG_MOVE:    Math.abs(changePercent) > 3,
    NO_MOVE:        Math.abs(changePercent) < 1,
    NEWS_PRESENT:   newsCount > 0 || catalystType.includes('NEWS') || catalystType.includes('EARN'),
    EARNINGS_NEAR:  catalystType.includes('EARN'),
    LARGE_CAP:      marketCap > 1_000_000_000,
    UNUSUAL_VOLUME: false,
    UNUSUAL_MOVE:   false,
  };

  const dir = changePercent >= 0 ? 'up' : 'down';
  const pct = Math.abs(changePercent).toFixed(2);
  const why = flags.NEWS_PRESENT
    ? `${symbol} is moving ${dir} ${pct}% — catalyst: ${signal.catalyst_type || 'news/earnings'}`
    : flags.HIGH_VOLUME
      ? `${symbol} is moving ${dir} ${pct}% with ${rvol.toFixed(1)}x avg volume — no clear news catalyst`
      : `${symbol} is moving ${dir} ${pct}% — price drifting without catalyst`;

  return {
    why,
    how: {
      setup:  flags.STRONG_MOVE && flags.HIGH_VOLUME ? 'Momentum continuation' : 'Wait for confirmation',
      entry:  changePercent > 0 ? 'Pullback hold above VWAP/intraday support' : 'Weak bounce rejection under resistance',
      risk:   'Defined stop below structure; no chasing vertical candles',
      target: 'Staged exits to next resistance/support level',
    },
    bias:       changePercent > 1 ? 'bullish' : changePercent < -1 ? 'bearish' : 'neutral',
    confidence: buildConfidence(flags),
  };
}

module.exports = {
  runNarrativeEngine,
  generateNarrative,
  buildNarrative,
};
