const express = require('express');
const pg = require('pg');

const { queryWithTimeout } = require('../db/pg');
const { resolveDatabaseUrl } = require('../db/connectionConfig');
const {
  getCompanyProfile,
  getPriceData,
  getFundamentals,
  getEarnings,
  getOwnership,
  getMarketContext,
  normalizeSymbol,
} = require('../services/researchCacheService');
const { buildTruthDecisionFromPayload } = require('../services/truthEngine');
const { buildEarningsEdge: buildEarningsEdgeEngine } = require('../engines/earningsEdgeEngine');
const { getIndicators, getDailyTechnicalSummary, emptyIndicators } = require('../engines/indicatorEngine');
const { getLatestScreenerPayload } = require('../v2/services/snapshotService');
const { computeDataConfidence, applyDataConfidenceGuard } = require('../services/dataConfidenceService');
const { ensureMarketSnapshotTable } = require('../services/marketSnapshotService');
const {
  buildDecisionScore,
  buildEarningsInsight,
  buildEarningsIntelligence,
  buildTradeProbability,
  calculateDrift,
} = require('../services/earningsIntelligence');

const router = express.Router();
const baseResponseCache = new Map();
const fullResponseCache = new Map();
const coverageSnapshotCache = new Map();
const DIRECT_COVERAGE_CLIENT_KEY = Symbol.for('openrange.research.directCoverageClient');
const DIRECT_COVERAGE_DISABLED_KEY = Symbol.for('openrange.research.directCoverageDisabled');
const BASE_RESPONSE_TTL_MS = 30 * 1000;
const FULL_RESPONSE_TTL_MS = 30 * 1000;
const ROUTE_QUERY_TIMEOUT_MS = 500;
const BASE_ROUTE_TOTAL_TIMEOUT_MS = 1500;
const RESEARCH_SECTION_TIMEOUT_MS = 750;
const RESEARCH_TOTAL_TIMEOUT_MS = 1500;
const RESEARCH_COVERAGE_TIMEOUT_MS = 750;

const EMPTY_SCANNER_PAYLOAD = {
  momentum_flow: {
    price: null,
    change_percent: null,
    gap_percent: null,
    relative_volume: null,
    volume: null,
    premarket_change_percent: null,
    premarket_volume: null,
    change_from_open_percent: null,
  },
  market_structure: {
    market_cap: null,
    float_shares: null,
    short_float_percent: null,
    avg_volume: null,
    spread_percent: null,
    shares_outstanding: null,
    sector: null,
    exchange: null,
  },
  technical: {
    rsi14: null,
    atr_percent: null,
    adr_percent: null,
    from_52w_high_percent: null,
    from_52w_low_percent: null,
    above_vwap: null,
    above_sma20: null,
    above_sma50: null,
    above_sma200: null,
    squeeze_setup: null,
    new_hod: null,
    beta: null,
  },
  catalyst_events: {
    days_to_earnings: null,
    earnings_surprise_percent: null,
    has_news_today: null,
    recent_insider_buy: null,
    recent_upgrade: null,
    recent_insider_buy_summary: null,
    recent_upgrade_summary: null,
    institutional_ownership_percent: null,
    insider_ownership_percent: null,
  },
  fundamentals: {
    pe: null,
    ps: null,
    eps_growth_percent: null,
    revenue_growth_percent: null,
    debt_equity: null,
    roe_percent: null,
    fcf_yield_percent: null,
    dividend_yield_percent: null,
  },
  options_flow: {
    iv_rank: null,
    put_call_ratio: null,
    options_volume: null,
    options_volume_vs_30d: null,
    net_premium: null,
    unusual_options: null,
  },
};

function getFreshCachedResponse(cache, key, ttlMs) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if ((Date.now() - entry.timestamp) >= ttlMs) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function logRouteQueryTime(label, startedAt) {
  const durationMs = Date.now() - startedAt;
  console.log('[QUERY TIME]', label, durationMs, 'ms');
  return durationMs;
}

function logResearchSectionTime(sectionName, durationMs, ok, timedOut, errorMessage = null) {
  console.log('[RESEARCH SECTION]', {
    section: sectionName,
    ok,
    timed_out: timedOut,
    duration_ms: durationMs,
    error: errorMessage,
  });
}

async function timedRouteQuery(sql, params, options = {}) {
  const startedAt = Date.now();
  try {
    return await queryWithTimeout(sql, params, {
      timeoutMs: ROUTE_QUERY_TIMEOUT_MS,
      maxRetries: 0,
      ...options,
    });
  } finally {
    logRouteQueryTime(options.label || 'research.route.query', startedAt);
  }
}

function buildSectionTimeoutError(sectionName, timeoutMs) {
  const error = new Error(`${sectionName} timed out after ${timeoutMs}ms`);
  error.code = 'SECTION_TIMEOUT';
  error.section = sectionName;
  return error;
}

function withDeadline(promiseFactory, timeoutMs, sectionName) {
  return Promise.race([
    Promise.resolve().then(promiseFactory),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(buildSectionTimeoutError(sectionName, timeoutMs)), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

async function loadResearchSection(sectionName, promiseFactory, fallbackValue, timeoutMs = RESEARCH_SECTION_TIMEOUT_MS) {
  const startedAt = Date.now();

  try {
    const value = await withDeadline(promiseFactory, timeoutMs, sectionName);
    const durationMs = Date.now() - startedAt;
    logResearchSectionTime(sectionName, durationMs, true, false, null);
    return {
      section: sectionName,
      ok: true,
      timedOut: false,
      value,
      duration_ms: durationMs,
      error: null,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.warn('[RESEARCH] section degraded', {
      section: sectionName,
      error: error.message,
      timedOut: error.code === 'SECTION_TIMEOUT',
      durationMs,
    });
    logResearchSectionTime(sectionName, durationMs, false, error.code === 'SECTION_TIMEOUT', error.message);

    return {
      section: sectionName,
      ok: false,
      timedOut: error.code === 'SECTION_TIMEOUT',
      value: fallbackValue,
      duration_ms: durationMs,
      error: error.message,
    };
  }
}

async function loadResearchNewsStatus(symbol) {
  const result = await timedRouteQuery(
    `SELECT
       UPPER($1) AS symbol,
       COUNT(*)::int AS news_count,
       MAX(published_at) AS last_news_at
     FROM news_articles
     WHERE UPPER(symbol) = UPPER($1)`,
    [symbol],
    {
      timeoutMs: ROUTE_QUERY_TIMEOUT_MS,
      label: 'research.news_status',
    }
  );

  const row = result.rows?.[0] || {};
  return {
    symbol,
    news_count: Number(row.news_count || 0),
    last_news_at: row.last_news_at || null,
    has_news: Number(row.news_count || 0) > 0,
    source: 'db',
  };
}

function normalizeProfilePayload(profile = {}, fundamentals = {}) {
  const beta = Number(profile?.beta);
  const pe = Number(profile?.pe);
  const fundamentalsPe = Number(fundamentals?.pe);
  const insiderOwnership = Number(profile?.insider_ownership_percent);

  return {
    ...profile,
    beta: Number.isFinite(beta) && beta > 0 ? beta : null,
    pe: Number.isFinite(pe) && pe !== 0 ? pe : (Number.isFinite(fundamentalsPe) ? fundamentalsPe : null),
    insider_ownership_percent: Number.isFinite(insiderOwnership) && insiderOwnership !== 0 ? insiderOwnership : null,
  };
}

function normalizeContextPayload(profile = {}, context = {}) {
  const sector = String(profile?.sector || '').trim().toLowerCase();
  const sectorLeaders = Array.isArray(context?.sectorLeaders) ? context.sectorLeaders : [];
  const hasSectorTailwind = sector
    ? sectorLeaders.some((row) => String(row?.sector || '').trim().toLowerCase() === sector)
    : false;

  return {
    ...context,
    sectorTailwind: hasSectorTailwind,
    lastUpdated: context?.lastUpdated || context?.updated_at || null,
  };
}

function buildResearchMeta(parts, startedAt) {
  const timestamps = parts
    .map((part) => Date.parse(String(part?.updated_at || part?.lastUpdated || '')))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left);
  const sources = parts.map((part) => String(part?.source || 'empty'));

  return {
    source: sources.join(','),
    cached: sources.length > 0 && sources.every((source) => source === 'cache'),
    stale: sources.some((source) => source.includes('stale') || source === 'empty'),
    updated_at: timestamps[0] ? new Date(timestamps[0]).toISOString() : null,
    total_ms: Date.now() - startedAt,
  };
}

function buildResearchPayloadFromSections(symbol, sections, startedAt) {
  const profile = normalizeProfilePayload(sections.profile?.value || {}, sections.fundamentals?.value || {});
  const context = normalizeContextPayload(profile, sections.context?.value || {});
  const earnings = sections.earnings?.value || {
    symbol,
    next: null,
    history: [],
    updated_at: null,
    source: 'empty',
    status: 'none',
    read: 'No upcoming earnings scheduled.',
  };

  return {
    profile,
    price: sections.price?.value || { symbol, price: null, change_percent: null, atr: null, updated_at: null, source: 'empty' },
    fundamentals: sections.fundamentals?.value || { symbol, trends: [], updated_at: null, source: 'empty' },
    earnings,
    ownership: sections.ownership?.value || { symbol, institutional: null, insider: null, etf: null, updated_at: null, source: 'empty' },
    context,
    meta: buildResearchMeta([
      profile,
      sections.price?.value,
      sections.fundamentals?.value,
      earnings,
      sections.ownership?.value,
      context,
    ], startedAt),
  };
}

function buildSnapshotBackfillSections(symbol, scoreRow) {
  if (!scoreRow || typeof scoreRow !== 'object') {
    return null;
  }

  const updatedAt = scoreRow.updated_at || scoreRow.snapshot_at || null;

  return {
    profile: {
      symbol,
      company_name: pickFirstString([scoreRow], ['company_name', 'company', 'name']),
      sector: pickFirstString([scoreRow], ['sector']),
      industry: pickFirstString([scoreRow], ['industry']),
      exchange: pickFirstString([scoreRow], ['exchange']),
      country: pickFirstString([scoreRow], ['country']),
      market_cap: pickFirstMeaningfulNumber([scoreRow], ['market_cap']),
      pe: pickFirstMeaningfulNumber([scoreRow], ['pe', 'pe_ratio']),
      beta: pickFirstMeaningfulNumber([scoreRow], ['beta']),
      insider_ownership_percent: normalizePercentLike(
        pickFirstMeaningfulNumber([scoreRow], ['insider_ownership_percent', 'insider_ownership'])
      ),
      updated_at: updatedAt,
      source: 'snapshot',
    },
    price: {
      symbol,
      price: pickFirstMeaningfulNumber([scoreRow], ['price', 'close']),
      change_percent: pickFirstNumber([scoreRow], ['change_percent', 'change']),
      atr: pickFirstMeaningfulNumber([scoreRow], ['atr']),
      updated_at: updatedAt,
      source: 'snapshot',
    },
    fundamentals: {
      symbol,
      trends: [],
      pe: pickFirstMeaningfulNumber([scoreRow], ['pe', 'pe_ratio']),
      ps: pickFirstMeaningfulNumber([scoreRow], ['ps', 'ps_ratio', 'price_to_sales']),
      eps_growth: normalizePercentLike(pickFirstNumber([scoreRow], ['eps_growth', 'epsGrowth'])),
      revenue_growth: normalizePercentLike(pickFirstNumber([scoreRow], ['revenue_growth', 'revenueGrowth', 'rev_growth'])),
      gross_margin: normalizePercentLike(pickFirstNumber([scoreRow], ['gross_margin'])),
      net_margin: normalizePercentLike(pickFirstNumber([scoreRow], ['net_margin'])),
      free_cash_flow: pickFirstNumber([scoreRow], ['free_cash_flow', 'fcf']),
      updated_at: updatedAt,
      source: 'snapshot',
    },
    ownership: {
      symbol,
      institutional: normalizePercentLike(
        pickFirstMeaningfulNumber([scoreRow], ['institutional_ownership_percent', 'institutional'])
      ),
      insider: normalizePercentLike(
        pickFirstMeaningfulNumber([scoreRow], ['insider_ownership_percent', 'insider_ownership'])
      ),
      etf: null,
      updated_at: updatedAt,
      source: 'snapshot',
    },
    context: {
      source: 'snapshot',
      sectorLeaders: [],
      sectorLaggers: [],
      updated_at: updatedAt,
      lastUpdated: updatedAt,
    },
  };
}

function hasUsableSnapshotSection(sectionName, value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  switch (sectionName) {
    case 'price':
      return toNumber(value.price) !== null;
    case 'profile':
      return Boolean(pickFirstString([value], ['company_name', 'sector', 'industry', 'exchange', 'country']));
    case 'fundamentals':
      return [
        pickFirstMeaningfulNumber([value], ['pe', 'ps']),
        pickFirstNumber([value], ['revenue_growth', 'eps_growth', 'free_cash_flow']),
      ].some((item) => item !== null);
    case 'ownership':
      return [toNumber(value.institutional), toNumber(value.insider)].some((item) => item !== null);
    case 'context':
      return Boolean(value.updated_at || value.lastUpdated || Array.isArray(value.sectorLeaders));
    default:
      return false;
  }
}

function resolveSectionWithSnapshot(sectionName, primarySection, snapshotValue) {
  if (primarySection?.ok) {
    return primarySection;
  }

  if (hasUsableSnapshotSection(sectionName, snapshotValue)) {
    return {
      section: sectionName,
      ok: true,
      timedOut: false,
      value: snapshotValue,
      duration_ms: primarySection?.duration_ms || 0,
      error: null,
    };
  }

  return primarySection;
}

function buildCoverageFromScoreRow(symbol, scoreRow) {
  if (!scoreRow || typeof scoreRow !== 'object') {
    return null;
  }

  const coverageScore = Number(scoreRow.coverage_score || 0);
  const newsCount = Number(scoreRow.news_count || 0);
  const earningsCount = Number(scoreRow.earnings_count || 0);
  const hasNews = Boolean(scoreRow.has_news) || newsCount > 0 || Boolean(scoreRow.latest_news_at);
  const hasEarnings = Boolean(scoreRow.has_earnings) || earningsCount > 0 || Boolean(scoreRow.next_earnings_date);
  const hasTechnicals = toNumber(scoreRow.price) !== null || Boolean(scoreRow.has_technicals);

  if (!(coverageScore > 0 || hasNews || hasEarnings || hasTechnicals)) {
    return null;
  }

  return {
    symbol,
    has_news: hasNews,
    has_earnings: hasEarnings,
    has_technicals: hasTechnicals,
    news_count: newsCount,
    earnings_count: earningsCount,
    daily_count: hasTechnicals ? 1 : 0,
    last_news_at: scoreRow.latest_news_at || null,
    last_earnings_at: scoreRow.next_earnings_date || null,
    coverage_score: coverageScore,
    last_checked: scoreRow.updated_at || scoreRow.snapshot_at || null,
  };
}

function hasCompleteBaseResearchResponse(response) {
  return Boolean(
    response?.data?.coverage
    && response?.data?.score
    && response?.decision
    && response?.why_moving
    && toNumber(response?.data?.overview?.price) !== null
  );
}

function hasCompleteFullResearchResponse(response) {
  return Boolean(
    response?.coverage
    && response?.score
    && response?.decision
    && response?.why_moving
    && toNumber(response?.price?.price) !== null
  );
}

async function loadResearchBaseSections(symbol, options = {}) {
  const {
    deferEarnings = false,
    prioritizePrice = false,
  } = options;
  const startedAt = Date.now();
  const emptyPrice = { symbol, price: null, change_percent: null, atr: null, updated_at: null, source: 'empty' };
  const emptyFundamentals = { symbol, trends: [], updated_at: null, source: 'empty' };
  const emptyEarnings = { symbol, next: null, history: [], updated_at: null, source: 'empty', status: 'none', read: 'No upcoming earnings scheduled.' };
  const emptyOwnership = { symbol, institutional: null, insider: null, etf: null, updated_at: null, source: 'empty' };
  const emptyContext = { source: 'empty', sectorLeaders: [], sectorLaggers: [], updated_at: null, lastUpdated: null };

  let price;
  let profile;
  let fundamentals;
  let ownership;
  let context;
  let earnings;

  if (prioritizePrice) {
    price = await loadResearchSection('price', () => getPriceData(symbol), emptyPrice);
    [profile, fundamentals, ownership, context] = await Promise.all([
      loadResearchSection('profile', () => getCompanyProfile(symbol), { symbol, source: 'empty' }),
      loadResearchSection('fundamentals', () => getFundamentals(symbol), emptyFundamentals),
      loadResearchSection('ownership', () => getOwnership(symbol), emptyOwnership),
      loadResearchSection('context', () => getMarketContext(), emptyContext),
    ]);
    earnings = deferEarnings
      ? { section: 'earnings', ok: false, timedOut: false, value: emptyEarnings, duration_ms: 0, error: 'deferred' }
      : await loadResearchSection('earnings', () => getEarnings(symbol), emptyEarnings);
  } else {
    [profile, price, fundamentals, earnings, ownership, context] = await Promise.all([
      loadResearchSection('profile', () => getCompanyProfile(symbol), { symbol, source: 'empty' }),
      loadResearchSection('price', () => getPriceData(symbol), emptyPrice),
      loadResearchSection('fundamentals', () => getFundamentals(symbol), emptyFundamentals),
      loadResearchSection('earnings', () => getEarnings(symbol), emptyEarnings),
      loadResearchSection('ownership', () => getOwnership(symbol), emptyOwnership),
      loadResearchSection('context', () => getMarketContext(), emptyContext),
    ]);
  }

  const sections = { profile, price, fundamentals, earnings, ownership, context };
  return {
    sections,
    payload: buildResearchPayloadFromSections(symbol, sections, startedAt),
    startedAt,
  };
}

function getRemainingResearchBudgetMs(startedAt, reserveMs = 250) {
  const remaining = RESEARCH_TOTAL_TIMEOUT_MS - (Date.now() - startedAt) - reserveMs;
  return remaining > 0 ? remaining : 0;
}

function buildResearchFallbackDecision(symbol, dataConfidence = { data_confidence: 0, data_confidence_label: 'POOR', freshness_score: 0, source_quality: 0 }) {
  return {
    symbol,
    tradeable: false,
    confidence: 20,
    freshness_score: dataConfidence.freshness_score,
    source_quality: dataConfidence.source_quality,
    setup: 'NO_SETUP',
    bias: 'NEUTRAL',
    driver: 'NO_DRIVER',
    earnings_edge: {
      label: 'NO_EDGE',
      score: 0,
      bias: 'NEUTRAL',
      next_date: null,
      report_time: null,
      expected_move_percent: null,
      status: 'none',
      read: 'No upcoming earnings scheduled.',
    },
    risk_flags: ['LOW_CONVICTION', 'NO_STRUCTURED_SETUP'],
    status: 'AVOID',
    action: 'AVOID',
    why: 'No clean driver confirmed.',
    how: 'Wait for a cleaner setup.',
    risk: 'Avoid trading without confirmation.',
    narrative: {
      why_this_matters: 'No clean catalyst or setup is confirmed right now.',
      what_to_do: 'Wait for a clear driver, stronger volume, and a structured setup.',
      what_to_avoid: 'Avoid forcing a trade into low-conviction conditions.',
      source: 'deterministic_fallback',
      locked: true,
    },
    execution_plan: null,
    source: 'truth_engine_fallback',
    why_moving: {
      driver: 'NO_DRIVER',
      summary: 'No earnings within 48 hours, no high-impact news, RVOL is below 2.0, and no confirmed breakout or breakdown is present.',
      tradeability: 'LOW',
      confidence_score: 20,
      bias: 'NEUTRAL',
      what_to_do: 'DO NOT TRADE. Wait for a confirmed catalyst or RVOL above 2.0.',
      what_to_avoid: 'Do not build a position off low-volume drift or recycled headlines.',
      setup: 'No valid setup.',
      trade_plan: null,
      action: 'DO NOT TRADE',
    },
    strategy_signals: {
      top_setup: null,
      setup_count: 0,
      stream_score: null,
      stream_headline: null,
    },
  };
}

async function loadDecisionSection(symbol, payload, dataConfidence, timeoutMs = RESEARCH_SECTION_TIMEOUT_MS) {
  const section = await loadResearchSection(
    'decision',
    () => buildTruthDecisionFromPayload({ symbol, payload, includeNarrative: false, allowRemoteNarrative: false }),
    buildResearchFallbackDecision(symbol, dataConfidence),
    timeoutMs,
  );

  return section.value || buildResearchFallbackDecision(symbol, dataConfidence);
}

function buildDirectSupabaseUrl(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    const username = String(parsed.username || '');
    const usernameParts = username.split('.');
    const projectRef = usernameParts[1];
    if (!projectRef) {
      return dbUrl;
    }

    parsed.hostname = `db.${projectRef}.supabase.co`;
    parsed.port = '5432';
    parsed.username = usernameParts[0] || 'postgres';
    return parsed.toString();
  } catch (_error) {
    return dbUrl;
  }
}

async function getDirectCoverageClient(timeoutMs) {
  if (global[DIRECT_COVERAGE_DISABLED_KEY]) {
    return null;
  }

  if (global[DIRECT_COVERAGE_CLIENT_KEY]?.client) {
    return global[DIRECT_COVERAGE_CLIENT_KEY].client;
  }

  const connectionState = global[Symbol.for('openrange.db.pool.singleton')] || {};
  const previousAllowDirectClient = connectionState.allowDirectClient;
  const dbUrl = buildDirectSupabaseUrl(resolveDatabaseUrl().dbUrl);
  connectionState.allowDirectClient = true;

  try {
    const client = new pg.Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: timeoutMs,
      statement_timeout: timeoutMs,
      query_timeout: timeoutMs,
      application_name: 'openrange-research-direct-coverage',
    });
    await client.connect();
    client.on('error', async () => {
      try {
        await client.end();
      } catch {
        // Ignore direct coverage client shutdown errors.
      }
      if (global[DIRECT_COVERAGE_CLIENT_KEY]?.client === client) {
        global[DIRECT_COVERAGE_CLIENT_KEY] = null;
      }
    });
    global[DIRECT_COVERAGE_CLIENT_KEY] = { client };
    return client;
  } finally {
    connectionState.allowDirectClient = previousAllowDirectClient;
  }
}

async function runDirectCoverageQuery(sql, symbol, timeoutMs, label) {
  const params = typeof symbol === 'undefined' ? [] : [symbol];
  try {
    const client = await getDirectCoverageClient(timeoutMs);
    if (!client) {
      throw new Error('direct_coverage_disabled');
    }
    const startedAt = Date.now();
    try {
      return await Promise.race([
        client.query(sql, params),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), Math.min(timeoutMs, ROUTE_QUERY_TIMEOUT_MS));
        }),
      ]);
    } finally {
      logRouteQueryTime(label, startedAt);
    }
  } catch (error) {
    if (String(error?.message || '').includes('ENETUNREACH')) {
      global[DIRECT_COVERAGE_DISABLED_KEY] = true;
    }

    if (global[DIRECT_COVERAGE_CLIENT_KEY]?.client) {
      try {
        await global[DIRECT_COVERAGE_CLIENT_KEY].client.end();
      } catch {
        // Ignore reset failures.
      }
      global[DIRECT_COVERAGE_CLIENT_KEY] = null;
    }

    return timedRouteQuery(sql, params, {
      timeoutMs: Math.min(timeoutMs, ROUTE_QUERY_TIMEOUT_MS),
      label,
    });
  }
}

function cacheCoverageSnapshotRow(row) {
  const symbol = normalizeSymbol(row?.symbol);
  if (!symbol) {
    return;
  }

  coverageSnapshotCache.set(symbol, {
    ...row,
    symbol,
    news_count: Number(row?.news_count || 0),
    earnings_count: Number(row?.earnings_count || 0),
    daily_count: Number(row?.daily_count || 0),
    coverage_score: Number(row?.coverage_score || 0),
    has_news: Boolean(row?.has_news),
    has_earnings: Boolean(row?.has_earnings),
    has_technicals: Boolean(row?.has_technicals),
  });
}

async function refreshCoverageSnapshotCache(timeoutMs = 10000) {
  const snapshotCacheSql = `SELECT symbol, has_news, has_earnings, has_technicals, news_count, earnings_count,
       CASE WHEN has_technicals THEN 1 ELSE 0 END AS daily_count,
       last_news_at, last_earnings_at, coverage_score, last_checked
     FROM data_coverage`;
  const result = await timedRouteQuery(snapshotCacheSql, [], {
    timeoutMs: Math.min(timeoutMs, ROUTE_QUERY_TIMEOUT_MS),
    label: 'research.coverage_snapshot_cache',
  });
  for (const row of result.rows || []) {
    cacheCoverageSnapshotRow(row);
  }
}

async function loadPrimaryCoverageSection(symbol, timeoutMs = RESEARCH_SECTION_TIMEOUT_MS) {
  const effectiveTimeoutMs = Math.max(RESEARCH_COVERAGE_TIMEOUT_MS, timeoutMs);
  return loadResearchSection(
    'coverage',
    async () => {
      const row = await loadDirectCoverageRow(symbol, effectiveTimeoutMs);
      return new Map([[symbol, row]]);
    },
    null,
    effectiveTimeoutMs,
  );
}

async function loadDirectCoverageRow(symbol, timeoutMs = 1500) {
  const directSnapshotSql = `SELECT symbol, has_news, has_earnings, has_technicals, news_count, earnings_count,
      CASE WHEN has_technicals THEN 1 ELSE 0 END AS daily_count,
      last_news_at, last_earnings_at, coverage_score, last_checked
     FROM data_coverage
     WHERE symbol = $1
     LIMIT 1`;
  const countSql = `SELECT
       UPPER($1) AS symbol,
  (SELECT COUNT(*)::int FROM news_articles WHERE symbol = $1) AS news_count,
  (SELECT COUNT(*)::int FROM earnings_history WHERE symbol = $1) AS earnings_count,
  (SELECT COUNT(*)::int FROM daily_ohlcv WHERE symbol = $1) AS daily_count`;
  const cachedRow = coverageSnapshotCache.get(symbol) || null;
  if (cachedRow) {
    return cachedRow;
  }

  const primaryTimeoutMs = Math.min(timeoutMs, ROUTE_QUERY_TIMEOUT_MS);
  const fallbackTimeoutMs = Math.min(timeoutMs, ROUTE_QUERY_TIMEOUT_MS);
  let row = null;

  try {
    const snapshotResult = await runDirectCoverageQuery(directSnapshotSql, symbol, primaryTimeoutMs, 'research.coverage_snapshot');
    row = snapshotResult.rows?.[0] || null;
  } catch (_error) {
    row = null;
  }

  if (!row) {
    try {
      const result = await runDirectCoverageQuery(countSql, symbol, fallbackTimeoutMs, 'research.coverage_counts');
      row = result.rows?.[0] || null;
    } catch (_error) {
      row = null;
    }
  }

  if (!row) {
    row = coverageSnapshotCache.get(symbol) || null;
  }

  if (!row) {
    return null;
  }

  cacheCoverageSnapshotRow(row);

  const newsCount = Number(row.news_count || 0);
  const earningsCount = Number(row.earnings_count || 0);
  const dailyCount = Number(row.daily_count || 0);
  const coverageScore = Number(row.coverage_score || 0) || ((newsCount > 0 ? 20 : 0)
    + (earningsCount > 0 ? 20 : 0)
    + (dailyCount > 0 ? 40 : 0)
    + 20);

  return {
    symbol,
    has_news: row.has_news != null ? Boolean(row.has_news) : newsCount > 0,
    has_earnings: row.has_earnings != null ? Boolean(row.has_earnings) : earningsCount > 0,
    has_technicals: row.has_technicals != null ? Boolean(row.has_technicals) : dailyCount > 0,
    news_count: newsCount,
    earnings_count: earningsCount,
    daily_count: dailyCount,
    last_news_at: row.last_news_at || null,
    last_earnings_at: row.last_earnings_at || null,
    coverage_score: coverageScore,
    last_checked: row.last_checked || new Date().toISOString(),
  };
}

function shouldCacheFullResearchResponse(response) {
  const meta = response?.meta || {};
  return !meta.partial && (!Array.isArray(meta.degraded_sections) || meta.degraded_sections.length === 0);
}

function clearResearchRouteCaches() {
  baseResponseCache.clear();
  fullResponseCache.clear();
  coverageSnapshotCache.clear();
}

async function warmResearchRouteResources() {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      try {
        const client = await getDirectCoverageClient(10000);
        if (client) {
          await client.query('SELECT 1');
        }
      } catch (error) {
        if (String(error?.message || '').includes('ENETUNREACH')) {
          global[DIRECT_COVERAGE_DISABLED_KEY] = true;
        } else {
          throw error;
        }
      }

      await refreshCoverageSnapshotCache(30000);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  throw lastError || new Error('research coverage warmup failed');
}

function mapTerminalPayloadToSnapshot(symbol, payload, extras = {}) {
  const coverage = extras.coverage || null;
  const score = extras.score || null;
  const scanner = extras.scanner || null;

  return {
    symbol,
    overview: {
      price: payload?.price?.price ?? null,
      change_percent: payload?.price?.change_percent ?? null,
      sector: payload?.profile?.sector ?? null,
      industry: payload?.profile?.industry ?? null,
      exchange: payload?.profile?.exchange ?? null,
      country: payload?.profile?.country ?? null,
    },
    fundamentals: {
      revenue_growth: payload?.fundamentals?.revenue_growth ?? null,
      eps_growth: payload?.fundamentals?.eps_growth ?? null,
      margins: {
        gross_margin: payload?.fundamentals?.gross_margin ?? null,
        net_margin: payload?.fundamentals?.net_margin ?? null,
      },
      cashflow: {
        free_cash_flow: payload?.fundamentals?.free_cash_flow ?? null,
      },
      debt: {
        debt_to_equity: null,
      },
      dcf_value: null,
    },
    earnings: {
      next_date: payload?.earnings?.next?.date ?? null,
      expected_move: payload?.earnings?.next?.expected_move_percent ?? null,
      eps_estimate: payload?.earnings?.next?.eps_estimate ?? null,
    },
    ownership: {
      institutional: payload?.ownership?.institutional ?? null,
      insider: payload?.ownership?.insider ?? null,
      etf: payload?.ownership?.etf ?? null,
    },
    coverage,
    score,
    scanner,
  };
}

function toDecisionOutput({ earningsEdge, tradeProbability, context }) {
  const baseScore = buildDecisionScore({
    earningsEdge,
    regime: context?.regime,
  });
  const reliabilityScore = Number(tradeProbability?.reliabilityScore || 0);
  const followThrough = Number(tradeProbability?.beatFollowThrough || 0);
  const sectorTailwind = Boolean(context?.sectorTailwind);

  let tradeScore = Math.max(0, baseScore);
  if (reliabilityScore >= 3) tradeScore += 2;
  else if (reliabilityScore >= 1.5) tradeScore += 1;
  if (sectorTailwind) tradeScore += 1;
  if (followThrough >= 0.7) tradeScore += 1;

  tradeScore = Math.max(0, Math.min(10, tradeScore));

  const confidence = tradeScore >= 7 ? 'HIGH' : tradeScore >= 4 ? 'MEDIUM' : 'LOW';
  const message = tradeScore >= 7
    ? 'High probability continuation setup'
    : tradeScore <= 3
      ? 'Low conviction — avoid'
      : 'Moderate setup — wait for confirmation';

  return {
    tradeScore,
    confidence,
    message,
  };
}

function normalizeCoveragePayload(symbol, coverageMap) {
  const row = coverageMap instanceof Map ? coverageMap.get(symbol) : null;
  const score = Number(row?.coverage_score || 0);

  return {
    symbol,
    has_news: Boolean(row?.has_news),
    has_earnings: Boolean(row?.has_earnings),
    has_technicals: Boolean(row?.has_technicals),
    news_count: Number(row?.news_count || 0),
    earnings_count: Number(row?.earnings_count || 0),
    last_news_at: row?.last_news_at || null,
    last_earnings_at: row?.last_earnings_at || null,
    coverage_score: score,
    status: score >= 100 ? 'COMPLETE' : score >= 60 ? 'PARTIAL' : 'LOW',
    tradeable: score >= 60,
    last_checked: row?.last_checked || null,
  };
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBooleanOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return null;
}

function pickFirstNumber(objects, keys) {
  for (const source of objects) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      const value = toNumber(source[key]);
      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

function pickFirstMeaningfulNumber(objects, keys) {
  for (const source of objects) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      const value = toNumber(source[key]);
      if (value !== null && value !== 0) {
        return value;
      }
    }
  }

  return null;
}

function pickFirstBoolean(objects, keys) {
  for (const source of objects) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      const value = toBooleanOrNull(source[key]);
      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

function pickFirstString(objects, keys) {
  for (const source of objects) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      const value = String(source[key] || '').trim();
      if (value) {
        return value;
      }
    }
  }

  return null;
}

function normalizePercentLike(value) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return null;
  }

  if (Math.abs(numeric) <= 1) {
    return Number((numeric * 100).toFixed(2));
  }

  return Number(numeric.toFixed(2));
}

function computePercentDelta(current, reference) {
  const currentValue = toNumber(current);
  const referenceValue = toNumber(reference);
  if (currentValue === null || referenceValue === null || referenceValue === 0) {
    return null;
  }

  return Number((((currentValue - referenceValue) / referenceValue) * 100).toFixed(2));
}

function computeDaysUntil(value) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const now = new Date();
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = new Date(parsed);
  const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((targetDay - currentDay) / 86400000);
}

function isSameUtcDay(value) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
}

async function readSymbolTableRow(tableName, symbol, label) {
  try {
    const result = await timedRouteQuery(
      `SELECT to_jsonb(t) AS row
       FROM ${tableName} t
       WHERE UPPER(t.symbol) = UPPER($1)
       LIMIT 1`,
      [symbol],
      {
        timeoutMs: ROUTE_QUERY_TIMEOUT_MS,
        label,
      }
    );

    return result.rows?.[0]?.row || null;
  } catch (error) {
    console.warn('[RESEARCH] metrics lookup failed', { symbol, tableName, error: error.message });
    return null;
  }
}

async function loadScannerSourceBundle(symbol) {
  try {
    await ensureMarketSnapshotTable().catch(() => null);
    const result = await timedRouteQuery(
      `SELECT
         to_jsonb(ms) AS market_snapshot,
         to_jsonb(mq) AS market_quote,
         to_jsonb(cp) AS company_profile,
         to_jsonb(fs) AS fundamentals_snapshot,
         to_jsonb(osnap) AS ownership_snapshot,
         to_jsonb(ti) AS technical_indicators
       FROM (SELECT $1::text AS symbol) s
       LEFT JOIN market_snapshot ms ON ms.symbol = s.symbol
       LEFT JOIN market_quotes mq ON mq.symbol = s.symbol
       LEFT JOIN company_profiles cp ON cp.symbol = s.symbol
       LEFT JOIN fundamentals_snapshot fs ON fs.symbol = s.symbol
       LEFT JOIN ownership_snapshot osnap ON osnap.symbol = s.symbol
       LEFT JOIN technical_indicators ti ON ti.symbol = s.symbol`,
      [symbol],
      {
        timeoutMs: ROUTE_QUERY_TIMEOUT_MS,
        label: 'research.scanner_source_bundle',
      }
    );

    return result.rows?.[0] || null;
  } catch (error) {
    console.warn('[RESEARCH] scanner bundle lookup failed', { symbol, error: error.message });
    return null;
  }
}

async function getResearchScannerSources(symbol) {
  const [bundle, dailySummary] = await Promise.all([
    loadScannerSourceBundle(symbol),
    getDailyTechnicalSummary(symbol).catch((error) => {
      console.warn('[RESEARCH] daily summary lookup failed', { symbol, error: error.message });
      return null;
    }),
  ]);

  return {
    marketQuote: bundle?.market_quote || bundle?.market_snapshot || null,
    marketMetrics: bundle?.market_snapshot || null,
    companyProfile: bundle?.company_profile || null,
    fundamentalsSnapshot: bundle?.fundamentals_snapshot || null,
    ownershipSnapshot: bundle?.ownership_snapshot || null,
    technicalIndicators: bundle?.technical_indicators || null,
    dailySummary,
  };
}

function buildScannerPayload({ payload, indicators, coverage, scoreRow, sources }) {
  const marketQuote = sources?.marketQuote || {};
  const marketMetrics = sources?.marketMetrics || {};
  const companyProfile = sources?.companyProfile || {};
  const fundamentalsSnapshot = sources?.fundamentalsSnapshot || {};
  const ownershipSnapshot = sources?.ownershipSnapshot || {};
  const technicalIndicators = sources?.technicalIndicators || {};
  const dailySummary = sources?.dailySummary || {};
  const currentPrice = pickFirstNumber([payload?.price, marketQuote, marketMetrics, technicalIndicators], ['price', 'close']);
  const marketCap = pickFirstNumber([marketQuote, companyProfile], ['market_cap', 'marketCap']);
  const avgVolume = pickFirstNumber([marketMetrics, marketQuote], ['avg_volume_30d', 'avg_volume', 'average_volume']);
  const sma20 = pickFirstNumber([dailySummary], ['sma20']);
  const sma50 = pickFirstNumber([dailySummary], ['sma50']);
  const sma200 = pickFirstNumber([dailySummary], ['sma200']);
  const latestNewsDate = scoreRow?.latest_news_at || coverage?.last_news_at || null;
  const hasNewsToday = isSameUtcDay(latestNewsDate);
  const institutionalOwnership = normalizePercentLike(
    pickFirstMeaningfulNumber([payload?.ownership, ownershipSnapshot], ['institutional_ownership_percent', 'institutional'])
  );
  const recentInsiderBuySummary = pickFirstString([payload?.ownership], ['recent_insider_buy_summary']);
  const recentUpgradeSummary = pickFirstString([payload?.ownership], ['recent_upgrade_summary']);

  return {
    momentum_flow: {
      price: currentPrice,
      change_percent: pickFirstNumber([payload?.price, marketQuote, marketMetrics, scoreRow], ['change_percent']),
      gap_percent: pickFirstNumber([marketMetrics, scoreRow], ['gap_percent']),
      relative_volume: pickFirstNumber([marketMetrics, marketQuote, scoreRow], ['relative_volume', 'rvol']),
      volume: pickFirstNumber([marketQuote, marketMetrics, scoreRow], ['volume']),
      premarket_change_percent: pickFirstNumber([marketQuote, marketMetrics], ['pm_change', 'premarket_change_percent', 'premarket_change']),
      premarket_volume: pickFirstNumber([marketQuote, marketMetrics], ['premarket_volume', 'pm_volume']),
      change_from_open_percent: pickFirstNumber([marketQuote, marketMetrics], ['change_from_open', 'change_from_open_percent'])
        ?? computePercentDelta(currentPrice, pickFirstNumber([dailySummary], ['latest_open'])),
    },
    market_structure: {
      market_cap: marketCap ?? pickFirstNumber([payload?.profile], ['market_cap']),
      float_shares: pickFirstNumber([marketMetrics, companyProfile, marketQuote], ['float_shares', 'float']),
      short_float_percent: normalizePercentLike(
        pickFirstMeaningfulNumber([marketQuote, marketMetrics], ['short_float', 'short_percent_float', 'short_float_percent'])
      ),
      avg_volume: avgVolume,
      spread_percent: pickFirstNumber([marketQuote, marketMetrics], ['spread_pct', 'spread_percent']),
      shares_outstanding: pickFirstNumber([marketQuote, marketMetrics, companyProfile], ['shares_out', 'shares_outstanding'])
        ?? (marketCap !== null && currentPrice !== null && currentPrice !== 0 ? Number((marketCap / currentPrice).toFixed(0)) : null),
      sector: pickFirstString([payload?.profile, companyProfile, marketQuote, scoreRow], ['sector']),
      exchange: pickFirstString([payload?.profile, companyProfile, marketQuote], ['exchange']),
    },
    technical: {
      rsi14: pickFirstNumber([technicalIndicators, marketMetrics], ['rsi14', 'rsi']),
      atr_percent: pickFirstNumber([marketMetrics, marketQuote], ['atr_percent'])
        ?? (() => {
          const atr = pickFirstNumber([payload?.price, marketMetrics], ['atr']);
          return atr !== null && currentPrice !== null && currentPrice !== 0 ? Number(((atr / currentPrice) * 100).toFixed(2)) : null;
        })(),
      adr_percent: pickFirstNumber([dailySummary], ['adr_pct']),
      from_52w_high_percent: computePercentDelta(currentPrice, pickFirstNumber([dailySummary], ['high_52w'])),
      from_52w_low_percent: (() => {
        const low = pickFirstNumber([dailySummary], ['low_52w']);
        if (currentPrice === null || low === null || low === 0) {
          return null;
        }

        return Number((((currentPrice - low) / low) * 100).toFixed(2));
      })(),
      above_vwap: indicators?.structure?.above_vwap ?? pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['above_vwap']),
      above_sma20: pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['above_sma20'])
        ?? (currentPrice !== null && sma20 !== null ? currentPrice > sma20 : null),
      above_sma50: pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['above_sma50'])
        ?? (currentPrice !== null && sma50 !== null ? currentPrice > sma50 : null),
      above_sma200: pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['above_sma200'])
        ?? (currentPrice !== null && sma200 !== null ? currentPrice > sma200 : null),
      squeeze_setup: pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['squeeze', 'squeeze_setup']),
      new_hod: pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['new_hod'])
        ?? (() => {
          const sessionHigh = pickFirstNumber([dailySummary], ['session_high']);
          return currentPrice !== null && sessionHigh !== null ? currentPrice >= sessionHigh : null;
        })(),
      beta: pickFirstMeaningfulNumber([payload?.profile, companyProfile, marketQuote, marketMetrics], ['beta']),
    },
    catalyst_events: {
      days_to_earnings: computeDaysUntil(payload?.earnings?.next?.date),
      earnings_surprise_percent: pickFirstNumber([payload?.earnings?.history?.[0] || {}, payload?.earnings?.next || {}], ['surprise_percent', 'surprisePercent']),
      has_news_today: hasNewsToday === null ? Boolean(coverage?.has_news) : hasNewsToday,
      recent_insider_buy: recentInsiderBuySummary ? true : pickFirstBoolean([marketQuote, marketMetrics], ['insider_buy', 'recent_insider_buy']),
      recent_upgrade: recentUpgradeSummary ? true : pickFirstBoolean([marketQuote, marketMetrics], ['analyst_upgrade', 'recent_upgrade']),
      recent_insider_buy_summary: recentInsiderBuySummary,
      recent_upgrade_summary: recentUpgradeSummary,
      institutional_ownership_percent: institutionalOwnership,
      insider_ownership_percent: normalizePercentLike(
        pickFirstMeaningfulNumber([payload?.profile, ownershipSnapshot, marketQuote, marketMetrics], ['insider_ownership_percent', 'insider_ownership', 'insider_percent'])
      ),
    },
    fundamentals: {
      pe: pickFirstMeaningfulNumber([payload?.fundamentals, fundamentalsSnapshot, payload?.profile, marketQuote, marketMetrics, companyProfile], ['pe', 'pe_ratio', 'trailing_pe', 'trailingPE']),
      ps: pickFirstMeaningfulNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote, marketMetrics, companyProfile], ['ps', 'ps_ratio', 'price_to_sales', 'priceToSalesTrailing12Months']),
      eps_growth_percent: normalizePercentLike(pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote], ['eps_growth', 'epsGrowth'])),
      revenue_growth_percent: normalizePercentLike(pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote], ['revenue_growth', 'revenueGrowth', 'rev_growth'])),
      debt_equity: pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote, marketMetrics], ['debt_to_equity', 'debt_equity']),
      roe_percent: normalizePercentLike(pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote, marketMetrics], ['roe_percent', 'roe', 'return_on_equity'])),
      fcf_yield_percent: normalizePercentLike(pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote, marketMetrics], ['fcf_yield_percent', 'fcf_yield', 'free_cash_flow_yield'])),
      dividend_yield_percent: normalizePercentLike(pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote, marketMetrics], ['dividend_yield_percent', 'dividend_yield', 'div_yield'])),
    },
    options_flow: {
      iv_rank: pickFirstNumber([marketQuote, marketMetrics], ['iv_rank']),
      put_call_ratio: pickFirstMeaningfulNumber([payload?.ownership, ownershipSnapshot, marketMetrics, marketQuote], ['put_call_ratio']),
      options_volume: pickFirstNumber([marketQuote, marketMetrics], ['opt_volume', 'options_volume', 'option_volume']),
      options_volume_vs_30d: pickFirstNumber([marketQuote, marketMetrics], ['opt_vol_vs_30d', 'options_volume_vs_30d', 'option_volume_vs_30d']),
      net_premium: pickFirstNumber([marketQuote, marketMetrics], ['net_premium']),
      unusual_options: pickFirstBoolean([marketQuote, marketMetrics], ['unusual_opts', 'unusual_options']),
    },
  };
}

function mergeResearchPayloadWithScannerSources(symbol, payload, sources) {
  if (!sources || typeof sources !== 'object') {
    return payload;
  }

  const marketQuote = sources.marketQuote || {};
  const marketMetrics = sources.marketMetrics || {};
  const companyProfile = sources.companyProfile || {};
  const fundamentalsSnapshot = sources.fundamentalsSnapshot || {};
  const ownershipSnapshot = sources.ownershipSnapshot || {};
  const updatedAt = pickFirstString([marketQuote, marketMetrics, companyProfile, fundamentalsSnapshot, ownershipSnapshot], ['updated_at']) || null;

  return {
    ...payload,
    profile: {
      ...payload.profile,
      symbol,
      sector: payload.profile?.sector ?? pickFirstString([companyProfile, marketQuote, marketMetrics], ['sector']),
      industry: payload.profile?.industry ?? pickFirstString([companyProfile, marketQuote], ['industry']),
      exchange: payload.profile?.exchange ?? pickFirstString([companyProfile, marketQuote], ['exchange']),
      country: payload.profile?.country ?? pickFirstString([companyProfile], ['country']),
      market_cap: payload.profile?.market_cap ?? pickFirstMeaningfulNumber([companyProfile, marketQuote, marketMetrics], ['market_cap']),
      beta: payload.profile?.beta ?? pickFirstMeaningfulNumber([companyProfile, marketQuote, marketMetrics], ['beta']),
      updated_at: payload.profile?.updated_at || updatedAt,
      source: payload.profile?.source === 'empty' ? 'scanner_sources' : payload.profile?.source,
    },
    price: {
      ...payload.price,
      symbol,
      price: payload.price?.price ?? pickFirstMeaningfulNumber([marketQuote, marketMetrics], ['price', 'close']),
      change_percent: payload.price?.change_percent ?? pickFirstNumber([marketQuote, marketMetrics], ['change_percent']),
      atr: payload.price?.atr ?? pickFirstMeaningfulNumber([marketMetrics], ['atr']),
      updated_at: payload.price?.updated_at || updatedAt,
      source: payload.price?.source === 'empty' ? 'scanner_sources' : payload.price?.source,
    },
    fundamentals: {
      ...payload.fundamentals,
      symbol,
      pe: payload.fundamentals?.pe ?? pickFirstMeaningfulNumber([fundamentalsSnapshot, marketQuote, marketMetrics], ['pe', 'pe_ratio']),
      ps: payload.fundamentals?.ps ?? pickFirstMeaningfulNumber([fundamentalsSnapshot, marketQuote, marketMetrics], ['ps', 'ps_ratio', 'price_to_sales']),
      revenue_growth: payload.fundamentals?.revenue_growth ?? normalizePercentLike(pickFirstNumber([fundamentalsSnapshot, marketQuote], ['revenue_growth', 'revenueGrowth', 'rev_growth'])),
      eps_growth: payload.fundamentals?.eps_growth ?? normalizePercentLike(pickFirstNumber([fundamentalsSnapshot, marketQuote], ['eps_growth', 'epsGrowth'])),
      gross_margin: payload.fundamentals?.gross_margin ?? normalizePercentLike(pickFirstNumber([fundamentalsSnapshot], ['gross_margin'])),
      net_margin: payload.fundamentals?.net_margin ?? normalizePercentLike(pickFirstNumber([fundamentalsSnapshot], ['net_margin'])),
      free_cash_flow: payload.fundamentals?.free_cash_flow ?? pickFirstNumber([fundamentalsSnapshot], ['free_cash_flow', 'fcf']),
      updated_at: payload.fundamentals?.updated_at || updatedAt,
      source: payload.fundamentals?.source === 'empty' ? 'scanner_sources' : payload.fundamentals?.source,
    },
    ownership: {
      ...payload.ownership,
      symbol,
      institutional: payload.ownership?.institutional ?? normalizePercentLike(pickFirstMeaningfulNumber([ownershipSnapshot], ['institutional_ownership_percent', 'institutional'])),
      insider: payload.ownership?.insider ?? normalizePercentLike(pickFirstMeaningfulNumber([ownershipSnapshot, companyProfile], ['insider_ownership_percent', 'insider_ownership'])),
      updated_at: payload.ownership?.updated_at || updatedAt,
      source: payload.ownership?.source === 'empty' ? 'scanner_sources' : payload.ownership?.source,
    },
  };
}

function buildScorePayload({ scoreRow, coverage, dataConfidence }) {
  return {
    final_score: Number(scoreRow?.final_score || 0),
    tqi: Number(scoreRow?.tqi || 0),
    tqi_label: scoreRow?.tqi_label || 'D',
    coverage_score: Number(scoreRow?.coverage_score || coverage?.coverage_score || 0),
    data_confidence: Number(scoreRow?.data_confidence || dataConfidence?.data_confidence || 0),
    data_confidence_label: scoreRow?.data_confidence_label || dataConfidence?.data_confidence_label || 'POOR',
    tradeable: Boolean(scoreRow?.tradeable ?? coverage?.tradeable),
    updated_at: scoreRow?.updated_at || null,
  };
}

async function getCachedScoreRowsBySymbol() {
  const rowsBySymbol = new Map();
  const snapshot = await getLatestScreenerPayload();

  for (const row of Array.isArray(snapshot?.data) ? snapshot.data : []) {
    if (!row?.symbol) continue;
    rowsBySymbol.set(row.symbol, row);
  }

  return rowsBySymbol;
}

router.get('/:symbol/full', async (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);
  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'symbol_required',
      message: 'A valid symbol is required.',
    });
  }

  const startedAt = Date.now();
  const cachedResponse = getFreshCachedResponse(fullResponseCache, symbol, FULL_RESPONSE_TTL_MS);
  if (cachedResponse) {
    return res.json(cachedResponse);
  }

  const parallelSectionTimeoutMs = RESEARCH_SECTION_TIMEOUT_MS;
  const coveragePromise = loadPrimaryCoverageSection(symbol, parallelSectionTimeoutMs);
  const newsSectionPromise = loadResearchSection('news', () => loadResearchNewsStatus(symbol), {
    symbol,
    news_count: 0,
    last_news_at: null,
    has_news: false,
    source: 'empty',
  }, parallelSectionTimeoutMs);
  const indicatorsPromise = loadResearchSection('indicators', () => getIndicators(symbol), emptyIndicators(), parallelSectionTimeoutMs);
  const scoreRowsPromise = loadResearchSection('score', () => getCachedScoreRowsBySymbol(), new Map(), parallelSectionTimeoutMs);
  const scannerSourcesPromise = loadResearchSection('scanner_sources', () => getResearchScannerSources(symbol), null, parallelSectionTimeoutMs);

  const { sections: baseSections, payload } = await loadResearchBaseSections(symbol);
  const initialCoverage = normalizeCoveragePayload(symbol, null);
  const initialConfidence = computeDataConfidence({ payload, indicators: emptyIndicators(), coverage: initialCoverage });
  let response = {
    success: true,
    profile: payload.profile,
    price: payload.price,
    fundamentals: payload.fundamentals,
    earnings: payload.earnings,
    earningsInsight: null,
    earningsEdge: null,
    tradeProbability: null,
    indicators: emptyIndicators(),
    coverage: initialCoverage,
    score: buildScorePayload({ scoreRow: null, coverage: initialCoverage, dataConfidence: initialConfidence }),
    scanner: EMPTY_SCANNER_PAYLOAD,
    data_confidence: initialConfidence.data_confidence,
    data_confidence_label: initialConfidence.data_confidence_label,
    freshness_score: initialConfidence.freshness_score,
    source_quality: initialConfidence.source_quality,
    decision: buildResearchFallbackDecision(symbol, initialConfidence),
    why_moving: buildResearchFallbackDecision(symbol, initialConfidence).why_moving,
    ownership: payload.ownership,
    context: payload.context,
    meta: {
      ...(payload.meta || {}),
      partial: false,
      degraded_sections: Object.values(baseSections).filter((section) => !section.ok).map((section) => section.section),
      section_status: Object.fromEntries(Object.entries(baseSections).map(([key, section]) => [key, {
        ok: section.ok,
        timed_out: section.timedOut,
        error: section.error,
        duration_ms: section.duration_ms,
      }])),
      total_ms: Date.now() - startedAt,
    },
  };
  response.meta.partial = !hasCompleteFullResearchResponse(response);

  if (getRemainingResearchBudgetMs(startedAt, 150) <= 0) {
    response = {
      ...response,
      meta: {
        ...(response.meta || {}),
        partial: true,
        route_timeout: 'base_budget_exhausted',
        total_ms: Date.now() - startedAt,
      },
    };
    console.log('[RESEARCH TOTAL]', { symbol, total_ms: response.meta.total_ms, partial: true, route_timeout: 'base_budget_exhausted' });
    return res.json(response);
  }

  try {
    const [indicatorsSection, coverageSection, newsSection, scoreRowsSection, scannerSourcesSection] = await Promise.all([
      indicatorsPromise,
      coveragePromise,
      newsSectionPromise,
      scoreRowsPromise,
      scannerSourcesPromise,
    ]);
    const enrichedPayload = mergeResearchPayloadWithScannerSources(symbol, payload, scannerSourcesSection.value);
    const coverage = normalizeCoveragePayload(symbol, coverageSection.value);
    const effectiveCoverageSection = coverageSection;
    const enrichedHistory = calculateDrift(buildEarningsIntelligence(enrichedPayload.earnings?.history || []));
    const earningsInsight = buildEarningsInsight({
      earnings: {
        ...enrichedPayload.earnings,
        history: enrichedHistory,
      },
      price: enrichedPayload.price?.price,
      atr: enrichedPayload.price?.atr,
    });
    const rawEarningsEdge = buildEarningsEdgeEngine(enrichedHistory);
    const tradeProbability = buildTradeProbability(enrichedHistory);
    const averageDrift1d = enrichedHistory.map((row) => Number(row?.drift1d)).filter((value) => Number.isFinite(value));
    const averageDrift3d = enrichedHistory.map((row) => Number(row?.drift3d)).filter((value) => Number.isFinite(value));
    const earningsEdge = {
      ...rawEarningsEdge,
      beatRate: rawEarningsEdge.beat_rate,
      missRate: Number((1 - Number(rawEarningsEdge.beat_rate || 0)).toFixed(4)),
      avgMove: rawEarningsEdge.avg_move,
      avgUpMove: rawEarningsEdge.avg_up_move,
      avgDownMove: rawEarningsEdge.avg_down_move,
      directionalBias: rawEarningsEdge.directional_bias,
      consistencyScore: rawEarningsEdge.consistency,
      edgeScore: rawEarningsEdge.edge_score,
      edgeLabel: rawEarningsEdge.edge_label,
      beatAvgMove: rawEarningsEdge.avg_up_move,
      avgDrift1d: averageDrift1d.length ? Number((averageDrift1d.reduce((sum, value) => sum + value, 0) / averageDrift1d.length).toFixed(2)) : null,
      avgDrift3d: averageDrift3d.length ? Number((averageDrift3d.reduce((sum, value) => sum + value, 0) / averageDrift3d.length).toFixed(2)) : null,
      followThroughPercent: Number(((tradeProbability.beatFollowThrough || 0) * 100).toFixed(2)),
      reliabilityScore: tradeProbability.reliabilityScore,
      confidenceLabel: 'LOW',
      earningsPattern: rawEarningsEdge.earnings_pattern || [],
    };
    const enrichedEarnings = {
      ...enrichedPayload.earnings,
      history: enrichedHistory,
      pattern: earningsEdge.earnings_pattern || [],
      edge: earningsEdge,
      read: enrichedPayload.earnings?.status === 'none'
        ? 'No upcoming earnings scheduled.'
        : enrichedPayload.earnings?.status === 'partial'
          ? 'Upcoming earnings scheduled. Some event details are still estimating.'
          : earningsEdge.read,
    };
    const decisionPayload = { ...enrichedPayload, earnings: enrichedEarnings };
    const dataConfidence = computeDataConfidence({ payload: decisionPayload, indicators: indicatorsSection.value, coverage });
    const decisionBudgetMs = getRemainingResearchBudgetMs(startedAt, 250);
    const rawDecision = decisionBudgetMs > 0
      ? await loadDecisionSection(symbol, decisionPayload, dataConfidence, Math.min(RESEARCH_SECTION_TIMEOUT_MS, decisionBudgetMs))
      : buildResearchFallbackDecision(symbol, dataConfidence);
    const decision = applyDataConfidenceGuard(rawDecision, dataConfidence);
    earningsEdge.confidenceLabel = decision.confidence >= 70 ? 'HIGH' : decision.confidence >= 55 ? 'MEDIUM' : 'LOW';
    const scoreRows = scoreRowsSection.value instanceof Map ? scoreRowsSection.value : new Map();
    const score = buildScorePayload({ scoreRow: scoreRows.get(symbol), coverage, dataConfidence });
    const scanner = scannerSourcesSection.value
      ? buildScannerPayload({
          payload: decisionPayload,
          indicators: indicatorsSection.value,
          coverage,
          scoreRow: scoreRows.get(symbol),
          sources: scannerSourcesSection.value,
        })
      : EMPTY_SCANNER_PAYLOAD;

    response = {
      ...response,
      profile: decisionPayload.profile,
      price: decisionPayload.price,
      fundamentals: decisionPayload.fundamentals,
      earnings: enrichedEarnings,
      earningsInsight,
      earningsEdge,
      tradeProbability,
      indicators: indicatorsSection.value,
      coverage,
      score,
      scanner,
      data_confidence: dataConfidence.data_confidence,
      data_confidence_label: dataConfidence.data_confidence_label,
      freshness_score: dataConfidence.freshness_score,
      source_quality: dataConfidence.source_quality,
      decision,
      why_moving: decision.why_moving,
      ownership: decisionPayload.ownership,
      context: decisionPayload.context,
      meta: {
        ...(response.meta || {}),
        partial: false,
        lazy_sections: ['earnings', 'fundamentals', 'scanner'],
        degraded_sections: [
          ...(response.meta?.degraded_sections || []),
          ...[indicatorsSection, effectiveCoverageSection, newsSection, scoreRowsSection, scannerSourcesSection].filter((section) => !section.ok).map((section) => section.section),
        ],
        section_status: {
          ...(response.meta?.section_status || {}),
          indicators: { ok: indicatorsSection.ok, timed_out: indicatorsSection.timedOut, error: indicatorsSection.error, duration_ms: indicatorsSection.duration_ms },
          coverage: { ok: effectiveCoverageSection.ok, timed_out: effectiveCoverageSection.timedOut, error: effectiveCoverageSection.error, duration_ms: effectiveCoverageSection.duration_ms },
          news: { ok: newsSection.ok, timed_out: newsSection.timedOut, error: newsSection.error, duration_ms: newsSection.duration_ms },
          score: { ok: scoreRowsSection.ok, timed_out: scoreRowsSection.timedOut, error: scoreRowsSection.error, duration_ms: scoreRowsSection.duration_ms },
          scanner_sources: { ok: scannerSourcesSection.ok, timed_out: scannerSourcesSection.timedOut, error: scannerSourcesSection.error, duration_ms: scannerSourcesSection.duration_ms },
        },
        total_ms: Date.now() - startedAt,
      },
    };
    response.meta.partial = !hasCompleteFullResearchResponse(response);
  } catch (error) {
    console.warn('[RESEARCH] full request degraded', { symbol, error: error.message });
    response = {
      ...response,
      meta: {
        ...(response.meta || {}),
        partial: false,
        route_error: error.message,
        total_ms: Date.now() - startedAt,
      },
    };
    response.meta.partial = !hasCompleteFullResearchResponse(response);
  }

  console.log('[RESEARCH TOTAL]', {
    symbol,
    total_ms: response?.meta?.total_ms ?? (Date.now() - startedAt),
    partial: Boolean(response?.meta?.partial),
    degraded_sections: response?.meta?.degraded_sections || [],
  });

  if (shouldCacheFullResearchResponse(response)) {
    fullResponseCache.set(symbol, {
      data: response,
      timestamp: Date.now(),
    });
  }

  return res.json(response);
});

router.get('/:symbol', async (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);
  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'symbol_required',
      message: 'A valid symbol is required.',
    });
  }

  const cachedResponse = getFreshCachedResponse(baseResponseCache, symbol, BASE_RESPONSE_TTL_MS);
  if (cachedResponse) {
    return res.json(cachedResponse);
  }

  const startedAt = Date.now();
  const parallelSectionTimeoutMs = Math.min(RESEARCH_SECTION_TIMEOUT_MS, BASE_ROUTE_TOTAL_TIMEOUT_MS);
  const emptyPrice = { symbol, price: null, change_percent: null, atr: null, updated_at: null, source: 'empty' };
  const emptyEarnings = { symbol, next: null, history: [], updated_at: null, source: 'empty', status: 'none', read: 'No upcoming earnings scheduled.' };
  const emptyProfile = { symbol, source: 'empty' };
  const emptyFundamentals = { symbol, trends: [], updated_at: null, source: 'empty' };
  const emptyOwnership = { symbol, institutional: null, insider: null, etf: null, updated_at: null, source: 'empty' };
  const emptyContext = { source: 'empty', sectorLeaders: [], sectorLaggers: [], updated_at: null, lastUpdated: null };
  const scoreRowsSection = await loadResearchSection('score', () => getCachedScoreRowsBySymbol(), new Map(), parallelSectionTimeoutMs);
  const scoreRows = scoreRowsSection.value instanceof Map ? scoreRowsSection.value : new Map();
  const snapshotRow = scoreRows.get(symbol) || null;
  const snapshotSections = buildSnapshotBackfillSections(symbol, snapshotRow);
  const coveragePromise = loadPrimaryCoverageSection(symbol, parallelSectionTimeoutMs);
  const pricePromise = loadResearchSection('price', () => getPriceData(symbol), emptyPrice, parallelSectionTimeoutMs);
  const [livePriceSection, liveCoverageSection] = await Promise.all([
    pricePromise,
    coveragePromise,
  ]);
  const priceSection = resolveSectionWithSnapshot('price', livePriceSection, snapshotSections?.price || emptyPrice);
  const snapshotCoverage = buildCoverageFromScoreRow(symbol, snapshotRow);
  const coverageSection = liveCoverageSection.ok || !snapshotCoverage
    ? liveCoverageSection
    : {
        section: 'coverage',
        ok: true,
        timedOut: false,
        value: new Map([[symbol, snapshotCoverage]]),
        duration_ms: liveCoverageSection.duration_ms,
        error: null,
      };
  const profileSection = {
    section: 'profile',
    ok: true,
    timedOut: false,
    value: snapshotSections?.profile || emptyProfile,
    duration_ms: 0,
    error: null,
  };
  const earningsSection = {
    section: 'earnings',
    ok: true,
    timedOut: false,
    value: emptyEarnings,
    duration_ms: 0,
    error: null,
  };
  const indicatorsSection = {
    section: 'indicators',
    ok: true,
    timedOut: false,
    value: emptyIndicators(),
    duration_ms: 0,
    error: null,
  };
  const baseSections = {
    profile: profileSection,
    price: priceSection,
    fundamentals: {
      section: 'fundamentals',
      ok: true,
      timedOut: false,
      value: snapshotSections?.fundamentals || emptyFundamentals,
      duration_ms: 0,
      error: null,
    },
    earnings: earningsSection,
    ownership: {
      section: 'ownership',
      ok: true,
      timedOut: false,
      value: snapshotSections?.ownership || emptyOwnership,
      duration_ms: 0,
      error: null,
    },
    context: {
      section: 'context',
      ok: true,
      timedOut: false,
      value: snapshotSections?.context || emptyContext,
      duration_ms: 0,
      error: null,
    },
  };
  const payload = buildResearchPayloadFromSections(symbol, baseSections, startedAt);

  const coverage = normalizeCoveragePayload(symbol, coverageSection.value);
  const effectiveCoverageSection = coverageSection;
  const dataConfidence = computeDataConfidence({ payload, indicators: indicatorsSection.value, coverage });
  const score = buildScorePayload({ scoreRow: snapshotRow, coverage, dataConfidence });
  const rawDecision = buildResearchFallbackDecision(symbol, dataConfidence);
  const decision = applyDataConfidenceGuard(rawDecision, dataConfidence);
  const whyMoving = decision.why_moving;

  const response = {
    success: true,
    data: {
      ...mapTerminalPayloadToSnapshot(symbol, payload, {
        coverage,
        score,
        scanner: EMPTY_SCANNER_PAYLOAD,
      }),
      decision,
      why_moving: whyMoving,
      data_confidence: dataConfidence.data_confidence,
      data_confidence_label: dataConfidence.data_confidence_label,
      freshness_score: dataConfidence.freshness_score,
      source_quality: dataConfidence.source_quality,
    },
    data_confidence: dataConfidence.data_confidence,
    data_confidence_label: dataConfidence.data_confidence_label,
    freshness_score: dataConfidence.freshness_score,
    source_quality: dataConfidence.source_quality,
    decision,
    why_moving: whyMoving,
    context: payload.context || null,
    meta: {
      symbol,
      source: `${payload.meta?.source || 'cache'},snapshot`,
      cached: Boolean(payload.meta?.cached),
      stale: Boolean(payload.meta?.stale),
      updated_at: payload.meta?.updated_at || null,
      cache_age_ms: null,
      partial: false,
      degraded_sections: [
        ...Object.values(baseSections).filter((section) => !section.ok).map((section) => section.section),
        ...[indicatorsSection, coverageSection, scoreRowsSection].filter((section) => !section.ok).map((section) => section.section),
      ],
      section_status: {
        ...Object.fromEntries(Object.entries(baseSections).map(([key, section]) => [key, {
          ok: section.ok,
          timed_out: section.timedOut,
          error: section.error,
          duration_ms: section.duration_ms,
        }])),
        indicators: { ok: indicatorsSection.ok, timed_out: indicatorsSection.timedOut, error: indicatorsSection.error, duration_ms: indicatorsSection.duration_ms },
        coverage: { ok: effectiveCoverageSection.ok, timed_out: effectiveCoverageSection.timedOut, error: effectiveCoverageSection.error, duration_ms: effectiveCoverageSection.duration_ms },
        score: { ok: scoreRowsSection.ok, timed_out: scoreRowsSection.timedOut, error: scoreRowsSection.error, duration_ms: scoreRowsSection.duration_ms },
      },
      total_ms: Date.now() - startedAt,
    },
  };
  console.log('[RESEARCH RESPONSE]', {
    symbol,
    hasPrice: toNumber(response?.data?.overview?.price) !== null,
    hasMetrics: Boolean(response?.data?.fundamentals || response?.data?.score),
    hasSignals: Boolean(response?.data?.decision || response?.data?.why_moving),
    total_ms: response?.meta?.total_ms,
  });
  response.meta.partial = !hasCompleteBaseResearchResponse(response);

  baseResponseCache.set(symbol, {
    data: response,
    timestamp: Date.now(),
  });

  return res.json(response);
});

module.exports = router;
module.exports.clearResearchRouteCaches = clearResearchRouteCaches;
module.exports.warmResearchRouteResources = warmResearchRouteResources;
