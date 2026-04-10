#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const pLimitModule = require('p-limit');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const { queryWithTimeout } = require('../db/pg');
const { fetchSymbolAuditData: fetchFinvizSymbol } = require('../adapters/finvizAdapter');
const { fetchSymbolAuditData: fetchUnusualWhalesSymbol } = require('../adapters/unusualWhalesAdapter');

const pLimit = typeof pLimitModule === 'function' ? pLimitModule : pLimitModule.default;

const API_BASE = process.env.TRUTH_AUDIT_API_BASE || 'http://127.0.0.1:3007';
const OUTPUT_UNIVERSE_PATH = path.resolve(__dirname, '..', '..', 'audit_universe.json');
const OUTPUT_REPORT_PATH = path.resolve(__dirname, '..', '..', 'truth-audit-report.json');
const NEWS_LOOKBACK_DAYS = Number(process.env.TRUTH_AUDIT_NEWS_LOOKBACK_DAYS || 7);
const PRICE_ACCURACY_THRESHOLD_PCT = Number(process.env.TRUTH_AUDIT_PRICE_THRESHOLD_PCT || 1);
const FETCH_CONCURRENCY = Math.max(1, Math.min(Number(process.env.TRUTH_AUDIT_CONCURRENCY) || 4, 8));

const MARKET_CAP_GROUPS = [
  { key: 'micro_cap', label: 'micro cap', min: 0, max: 300_000_000 },
  { key: 'small_cap', label: 'small cap', min: 300_000_000, max: 2_000_000_000 },
  { key: 'mid_cap', label: 'mid cap', min: 2_000_000_000, max: 10_000_000_000 },
  { key: 'large_cap', label: 'large cap', min: 10_000_000_000, max: 200_000_000_000 },
  { key: 'mega_cap', label: 'mega cap', min: 200_000_000_000, max: null },
];

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function mapConfidence(value) {
  if (typeof value === 'number') return Math.max(0, Math.min(100, Math.round(value)));
  const text = String(value || '').trim().toUpperCase();
  if (text === 'HIGH') return 85;
  if (text === 'MEDIUM') return 60;
  if (text === 'LOW') return 30;
  return null;
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function parseDecision(payload) {
  const decision = payload?.decision || {};
  const whyMoving = payload?.why_moving || {};

  return {
    driver: String(decision.driver || whyMoving.driver || 'NO_DRIVER').trim().toUpperCase() || 'NO_DRIVER',
    tradeability: String(decision.status || whyMoving.tradeability || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN',
    confidence: mapConfidence(decision.confidence) ?? toNumber(whyMoving.confidence_score) ?? 0,
  };
}

function scorePriceAccuracy(diffPct) {
  if (!Number.isFinite(diffPct)) return 0;
  if (diffPct <= 0.5) return 100;
  if (diffPct <= 1) return 90;
  if (diffPct <= 2) return 75;
  if (diffPct <= 5) return 50;
  if (diffPct <= 10) return 25;
  return 0;
}

function scoreVolumeAccuracy(volumeRatio) {
  if (!Number.isFinite(volumeRatio) || volumeRatio <= 0) return 0;
  const normalized = volumeRatio > 1 ? 1 / volumeRatio : volumeRatio;
  if (normalized >= 0.95) return 100;
  if (normalized >= 0.8) return 80;
  if (normalized >= 0.6) return 60;
  if (normalized >= 0.4) return 35;
  return 0;
}

function scoreEarningsAccuracy(openRangeDate, externalDate, providerCount) {
  if (!providerCount) return 0;
  if (!openRangeDate && !externalDate) return 100;
  if (!externalDate && openRangeDate) return 40;
  if (externalDate && !openRangeDate) return 0;
  return openRangeDate === externalDate ? 100 : 0;
}

function scoreNewsCoverage(openRangeNewsCount, externalNewsCount, providerCount) {
  if (!providerCount) return 0;
  const openHasNews = Number(openRangeNewsCount || 0) > 0;
  const externalHasNews = Number(externalNewsCount || 0) > 0;

  if (externalHasNews) {
    return openHasNews ? 100 : 0;
  }

  return openHasNews ? 70 : 100;
}

function scoreDecisionUsefulness(issueFlags) {
  if (issueFlags.includes('high_confidence_but_no_catalyst')) return 0;
  if (issueFlags.includes('low_confidence_but_high_move')) return 25;
  return 50;
}

function percent(part, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await response.json();
  return { ok: response.ok, status: response.status, body };
}

async function buildUniverse() {
  const groups = [];

  for (const group of MARKET_CAP_GROUPS) {
    const params = [group.min];
    let maxClause = '';
    if (group.max !== null) {
      params.push(group.max);
      maxClause = 'AND tu.market_cap::numeric < $2';
    }

    const result = await queryWithTimeout(
      `WITH latest_quotes AS (
         SELECT DISTINCT ON (UPPER(symbol))
           UPPER(symbol) AS symbol,
           price::numeric AS price,
           volume::numeric AS volume,
           COALESCE(last_updated, updated_at) AS updated_at
         FROM market_quotes
         WHERE symbol IS NOT NULL
           AND symbol ~ '^[A-Z]{1,5}$'
           AND price IS NOT NULL
           AND price > 0
         ORDER BY UPPER(symbol), COALESCE(last_updated, updated_at) DESC NULLS LAST
       )
       SELECT
         UPPER(tu.symbol) AS symbol,
         tu.market_cap::numeric AS market_cap,
         lq.price,
         lq.volume,
         lq.updated_at
       FROM ticker_universe tu
       INNER JOIN latest_quotes lq
         ON UPPER(tu.symbol) = lq.symbol
       WHERE tu.symbol IS NOT NULL
         AND tu.symbol ~ '^[A-Z]{1,5}$'
         AND tu.market_cap IS NOT NULL
         AND tu.market_cap::numeric >= $1
         ${maxClause}
       ORDER BY lq.volume DESC NULLS LAST, tu.market_cap DESC NULLS LAST
       LIMIT 10`,
      params,
      {
        timeoutMs: 12000,
        label: `truth_audit.universe.${group.key}`,
        maxRetries: 0,
      }
    );

    const symbols = (result.rows || []).map((row) => ({
      symbol: normalizeSymbol(row.symbol),
      market_cap: toNumber(row.market_cap),
      seed_price: toNumber(row.price),
      seed_volume: toNumber(row.volume),
      quote_updated_at: row.updated_at || null,
    }));

    groups.push({
      key: group.key,
      label: group.label,
      symbol_count: symbols.length,
      symbols,
    });
  }

  const flatSymbols = groups.flatMap((group) => group.symbols.map((row) => ({
    symbol: row.symbol,
    market_cap_group: group.key,
    market_cap: row.market_cap,
  })));

  const payload = {
    generated_at: new Date().toISOString(),
    total_symbols: flatSymbols.length,
    groups,
    flat_symbols: flatSymbols,
  };

  writeJson(OUTPUT_UNIVERSE_PATH, payload);
  return payload;
}

async function loadOpenRangeSupportMaps(symbols) {
  const symbolList = symbols.map(normalizeSymbol).filter(Boolean);
  const [quoteResult, newsResult] = await Promise.all([
    queryWithTimeout(
      `WITH latest_quotes AS (
         SELECT DISTINCT ON (UPPER(COALESCE(mq.symbol, mm.symbol)))
           UPPER(COALESCE(mq.symbol, mm.symbol)) AS symbol,
           COALESCE(mq.price, mm.price)::numeric AS price,
           COALESCE(mq.change_percent, mm.change_percent)::numeric AS change_percent,
           COALESCE(mq.volume, mm.volume)::numeric AS volume,
           COALESCE(mq.last_updated, mq.updated_at, mm.updated_at) AS updated_at
         FROM market_quotes mq
         FULL OUTER JOIN market_metrics mm
           ON UPPER(mm.symbol) = UPPER(mq.symbol)
         WHERE UPPER(COALESCE(mq.symbol, mm.symbol)) = ANY($1::text[])
         ORDER BY UPPER(COALESCE(mq.symbol, mm.symbol)), COALESCE(mq.last_updated, mq.updated_at, mm.updated_at) DESC NULLS LAST
       )
       SELECT symbol, price, change_percent, volume, updated_at
       FROM latest_quotes`,
      [symbolList],
      {
        timeoutMs: 12000,
        label: 'truth_audit.support.latest_quotes',
        maxRetries: 0,
      }
    ),
    queryWithTimeout(
      `SELECT UPPER(symbol) AS symbol, COUNT(*)::int AS news_count
       FROM news_articles
       WHERE UPPER(symbol) = ANY($1::text[])
         AND COALESCE(published_at, published_date, created_at) >= NOW() - ($2::text || ' days')::interval
       GROUP BY UPPER(symbol)`,
      [symbolList, String(NEWS_LOOKBACK_DAYS)],
      {
        timeoutMs: 12000,
        label: 'truth_audit.support.news_counts',
        maxRetries: 0,
      }
    ),
  ]);

  return {
    quotesBySymbol: new Map((quoteResult.rows || []).map((row) => [normalizeSymbol(row.symbol), {
      price: toNumber(row.price),
      change_percent: toNumber(row.change_percent),
      volume: toNumber(row.volume),
      updated_at: row.updated_at || null,
    }])),
    newsCountBySymbol: new Map((newsResult.rows || []).map((row) => [normalizeSymbol(row.symbol), Number(row.news_count || 0)])),
  };
}

async function fetchOpenRangeSymbol(symbol, supportMaps) {
  const endpoint = `${API_BASE}/api/research/${encodeURIComponent(symbol)}/full`;
  const response = await fetchJson(endpoint);
  const payload = response.body || {};
  const supportQuote = supportMaps.quotesBySymbol.get(symbol) || {};
  const supportNewsCount = supportMaps.newsCountBySymbol.get(symbol) || 0;
  const priceRow = payload.price || {};
  const earningsRow = payload.earnings || {};
  const nextEarnings = earningsRow.next || earningsRow;
  const decision = parseDecision(payload);

  return {
    symbol,
    ok: response.ok,
    status: response.status,
    price: toNumber(priceRow.price) ?? supportQuote.price,
    change_percent: toNumber(priceRow.change_percent) ?? supportQuote.change_percent,
    volume: toNumber(priceRow.volume) ?? supportQuote.volume,
    earnings_next_date: normalizeDateKey(nextEarnings?.date || nextEarnings?.report_date),
    earnings_expected_move: toNumber(nextEarnings?.expected_move_percent ?? nextEarnings?.expected_move ?? nextEarnings?.expectedMove),
    news_count: toNumber(payload?.news_count) ?? supportNewsCount,
    driver: decision.driver,
    tradeability: decision.tradeability,
    confidence: decision.confidence,
    source_endpoint: endpoint,
  };
}

function aggregateExternalData(symbol, finviz, unusualWhales) {
  const providers = [finviz, unusualWhales].filter((row) => row && row.available !== false);
  const prices = providers.map((row) => toNumber(row.price)).filter((value) => value !== null);
  const changePercents = providers.map((row) => toNumber(row.change_percent)).filter((value) => value !== null);
  const volumes = providers.map((row) => toNumber(row.volume)).filter((value) => value !== null && value > 0);
  const earningsDates = providers.map((row) => normalizeDateKey(row.earnings_date)).filter(Boolean);
  const newsCounts = providers.map((row) => Number(row.news_count || 0)).filter((value) => Number.isFinite(value));

  return {
    symbol,
    provider_count: providers.length,
    price: prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : null,
    change_percent: changePercents.length ? changePercents.reduce((sum, value) => sum + value, 0) / changePercents.length : null,
    volume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : null,
    earnings_date: earningsDates[0] || null,
    news_count: newsCounts.length ? Math.max(...newsCounts) : null,
    providers: {
      finviz,
      unusual_whales: unusualWhales,
    },
  };
}

function compareSymbol(openRange, external) {
  const priceDiffPercent = Number.isFinite(openRange.price) && Number.isFinite(external.price) && external.price > 0
    ? Math.abs((openRange.price - external.price) / external.price) * 100
    : null;
  const changeDiff = Number.isFinite(openRange.change_percent) && Number.isFinite(external.change_percent)
    ? Math.abs(openRange.change_percent - external.change_percent)
    : null;
  const volumeRatio = Number.isFinite(openRange.volume) && Number.isFinite(external.volume) && external.volume > 0
    ? openRange.volume / external.volume
    : null;
  const earningsMatch = Boolean(openRange.earnings_next_date && external.earnings_date && openRange.earnings_next_date === external.earnings_date);
  const newsPresent = Number(openRange.news_count || 0) > 0 && Number(external.news_count || 0) > 0;

  const issueFlags = [];
  if (!external.provider_count) issueFlags.push('external_data_unavailable');
  if (!openRange.earnings_next_date && external.earnings_date) issueFlags.push('missing_earnings');
  if (Number(openRange.news_count || 0) === 0) issueFlags.push('no_news');
  if (Number.isFinite(priceDiffPercent) && priceDiffPercent > PRICE_ACCURACY_THRESHOLD_PCT) issueFlags.push('incorrect_pricing');
  if (Math.abs(Number(openRange.change_percent || 0)) >= 5 && Number(openRange.confidence || 0) < 50) issueFlags.push('low_confidence_but_high_move');
  if (Number(openRange.confidence || 0) >= 70 && (!openRange.driver || openRange.driver === 'NO_DRIVER')) issueFlags.push('high_confidence_but_no_catalyst');

  const componentScores = {
    price_accuracy: scorePriceAccuracy(priceDiffPercent),
    earnings_accuracy: scoreEarningsAccuracy(openRange.earnings_next_date, external.earnings_date, external.provider_count),
    news_coverage: scoreNewsCoverage(openRange.news_count, external.news_count, external.provider_count),
    volume_accuracy: scoreVolumeAccuracy(volumeRatio),
    decision_usefulness: scoreDecisionUsefulness(issueFlags),
  };

  const truthScore = round(
    componentScores.price_accuracy * 0.2
    + componentScores.earnings_accuracy * 0.25
    + componentScores.news_coverage * 0.2
    + componentScores.volume_accuracy * 0.15
    + componentScores.decision_usefulness * 0.2,
    2,
  );

  return {
    price_diff_percent: round(priceDiffPercent, 4),
    change_diff: round(changeDiff, 4),
    volume_ratio: round(volumeRatio, 4),
    earnings_match: earningsMatch,
    news_present: newsPresent,
    decision_validity: 'PENDING_MANUAL_REVIEW',
    truth_score: truthScore,
    component_scores: componentScores,
    issue_flags: issueFlags,
  };
}

async function run() {
  const startedAt = Date.now();
  const universe = await buildUniverse();
  const symbols = universe.flat_symbols.map((row) => row.symbol);
  const capGroupBySymbol = new Map(universe.flat_symbols.map((row) => [row.symbol, row.market_cap_group]));
  const supportMaps = await loadOpenRangeSupportMaps(symbols);
  const limit = pLimit(FETCH_CONCURRENCY);

  const rows = await Promise.all(symbols.map((symbol) => limit(async () => {
    const [openRange, finviz, unusualWhales] = await Promise.all([
      fetchOpenRangeSymbol(symbol, supportMaps),
      fetchFinvizSymbol(symbol),
      fetchUnusualWhalesSymbol(symbol),
    ]);

    const external = aggregateExternalData(symbol, finviz, unusualWhales);
    const comparison = compareSymbol(openRange, external);

    return {
      symbol,
      market_cap_group: capGroupBySymbol.get(symbol) || null,
      openrange: openRange,
      external,
      comparison,
    };
  })));

  const averageByGroup = MARKET_CAP_GROUPS.map((group) => {
    const groupRows = rows.filter((row) => row.market_cap_group === group.key);
    const avgTruthScore = groupRows.length
      ? groupRows.reduce((sum, row) => sum + Number(row.comparison.truth_score || 0), 0) / groupRows.length
      : 0;

    return {
      market_cap_group: group.key,
      label: group.label,
      ticker_count: groupRows.length,
      average_truth_score: round(avgTruthScore, 2),
    };
  });

  const worstTickers = [...rows]
    .sort((left, right) => Number(left.comparison.truth_score || 0) - Number(right.comparison.truth_score || 0))
    .slice(0, 10)
    .map((row) => ({
      symbol: row.symbol,
      market_cap_group: row.market_cap_group,
      truth_score: row.comparison.truth_score,
      issue_flags: row.comparison.issue_flags,
    }));

  const missingDataSummary = rows.reduce((acc, row) => {
    if (!row.openrange.earnings_next_date) acc.missing_openrange_earnings += 1;
    if (Number(row.openrange.news_count || 0) === 0) acc.missing_openrange_news += 1;
    if (!Number.isFinite(row.openrange.price)) acc.missing_openrange_price += 1;
    if (!Number.isFinite(row.openrange.volume)) acc.missing_openrange_volume += 1;
    if (!row.external.providers.finviz?.available) acc.finviz_unavailable += 1;
    if (!row.external.providers.unusual_whales?.available) acc.unusual_whales_unavailable += 1;
    return acc;
  }, {
    missing_openrange_earnings: 0,
    missing_openrange_news: 0,
    missing_openrange_price: 0,
    missing_openrange_volume: 0,
    finviz_unavailable: 0,
    unusual_whales_unavailable: 0,
  });

  const earningsComparableCount = rows.filter((row) => Boolean(row.external.earnings_date)).length;
  const earningsCoverageNumerator = rows.filter((row) => Boolean(row.external.earnings_date) && Boolean(row.openrange.earnings_next_date)).length;

  const newsComparableCount = rows.filter((row) => Number(row.external.news_count || 0) > 0).length;
  const newsCoverageNumerator = rows.filter((row) => Number(row.external.news_count || 0) > 0 && Number(row.openrange.news_count || 0) > 0).length;

  const priceComparableCount = rows.filter((row) => Number.isFinite(row.external.price)).length;
  const priceAccuracyNumerator = rows.filter((row) => Number.isFinite(row.comparison.price_diff_percent) && row.comparison.price_diff_percent <= PRICE_ACCURACY_THRESHOLD_PCT).length;

  const averageTruthScore = rows.length
    ? rows.reduce((sum, row) => sum + Number(row.comparison.truth_score || 0), 0) / rows.length
    : 0;

  const report = {
    generated_at: new Date().toISOString(),
    api_base: API_BASE,
    universe_path: path.basename(OUTPUT_UNIVERSE_PATH),
    total_tickers: rows.length,
    per_ticker_breakdown: rows,
    average_score_per_market_cap_group: averageByGroup,
    worst_10_tickers: worstTickers,
    missing_data_summary: missingDataSummary,
    validation: {
      average_truth_score: round(averageTruthScore, 2),
      earnings_coverage_percent: percent(earningsCoverageNumerator, earningsComparableCount),
      earnings_coverage_compared_tickers: earningsComparableCount,
      news_coverage_percent: percent(newsCoverageNumerator, newsComparableCount),
      news_coverage_compared_tickers: newsComparableCount,
      price_accuracy_percent: percent(priceAccuracyNumerator, priceComparableCount),
      price_accuracy_compared_tickers: priceComparableCount,
      price_accuracy_threshold_percent: PRICE_ACCURACY_THRESHOLD_PCT,
    },
    metadata: {
      news_lookback_days: NEWS_LOOKBACK_DAYS,
      fetch_concurrency: FETCH_CONCURRENCY,
      unusual_whales_configured: Boolean(process.env.UNUSUAL_WHALES_BASE_URL && process.env.UNUSUAL_WHALES_API_KEY),
      duration_ms: Date.now() - startedAt,
    },
  };

  writeJson(OUTPUT_REPORT_PATH, report);
  console.log(JSON.stringify({
    average_truth_score: report.validation.average_truth_score,
    earnings_coverage_percent: report.validation.earnings_coverage_percent,
    news_coverage_percent: report.validation.news_coverage_percent,
    price_accuracy_percent: report.validation.price_accuracy_percent,
    total_tickers: rows.length,
    report_path: OUTPUT_REPORT_PATH,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});