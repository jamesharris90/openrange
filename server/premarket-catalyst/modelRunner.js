const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');
const { getMarketContext } = require('../ingestion/fmp_market_context_ingest');
const {
  deriveCatalystSignal,
  scoreCatalyst,
  scoreGap,
  scoreVolume,
  scoreStructure,
  scoreRegime,
  computeCompositeScore,
} = require('./scoring');
const {
  classifyLabel,
  generateRiskFlags,
  deriveStructureType,
  deriveTradeState,
  generateWhy,
} = require('./labelClassifier');

const GENERATOR = 'premarket_catalyst_v1';
const MAX_SYMBOL_RUNTIME_MS = 500;
const DUE_MINUTES = [5, 15, 30, 60];

const SECTOR_TO_ETF = new Map([
  ['Financials', 'XLF'],
  ['Financial Services', 'XLF'],
  ['Energy', 'XLE'],
  ['Technology', 'XLK'],
  ['Information Technology', 'XLK'],
  ['Industrials', 'XLI'],
  ['Health Care', 'XLV'],
  ['Healthcare', 'XLV'],
  ['Consumer Staples', 'XLP'],
  ['Consumer Defensive', 'XLP'],
  ['Consumer Discretionary', 'XLY'],
  ['Consumer Cyclical', 'XLY'],
  ['Materials', 'XLB'],
  ['Basic Materials', 'XLB'],
  ['Utilities', 'XLU'],
  ['Real Estate', 'XLRE'],
  ['Communication Services', 'XLC'],
  ['Communication', 'XLC'],
]);

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function roundNumber(value, decimals = 2) {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  return Number(numeric.toFixed(decimals));
}

function normalizeAsOf(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid asOf timestamp: ${value}`);
  }
  return date;
}

function subtractMinutes(date, minutes) {
  return new Date(date.getTime() - minutes * 60 * 1000);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatTimeOfDay(date) {
  return date.toISOString().slice(11, 19);
}

function computeWindow(asOf) {
  return {
    asOf,
    windowStart: subtractMinutes(asOf, 60),
    last15Start: subtractMinutes(asOf, 15),
  };
}

function groupBySymbol(rows = [], key = 'symbol') {
  return rows.reduce((accumulator, row) => {
    const symbol = String(row?.[key] || '').trim().toUpperCase();
    if (!symbol) return accumulator;
    if (!accumulator.has(symbol)) accumulator.set(symbol, []);
    accumulator.get(symbol).push(row);
    return accumulator;
  }, new Map());
}

function mapRowsBySymbol(rows = []) {
  return rows.reduce((accumulator, row) => {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (!symbol) return accumulator;
    accumulator.set(symbol, row);
    return accumulator;
  }, new Map());
}

function mapSectorToEtf(sector) {
  const normalized = String(sector || '').trim();
  return SECTOR_TO_ETF.get(normalized) || null;
}

function buildPremarketBars(metricRow) {
  const lows = Array.isArray(metricRow?.last5_lows) ? [...metricRow.last5_lows].reverse() : [];
  const closes = Array.isArray(metricRow?.last5_closes) ? [...metricRow.last5_closes].reverse() : [];
  const count = Math.max(lows.length, closes.length);
  return Array.from({ length: count }, (_, index) => ({
    low: toNumber(lows[index]),
    close: toNumber(closes[index]),
  }));
}

function pickMarketData(universeRow, detailRow) {
  return {
    previousClose: toNumber(detailRow?.previous_close) ?? toNumber(detailRow?.metric_previous_close) ?? null,
    marketCap: toInteger(detailRow?.quote_market_cap) ?? toInteger(detailRow?.profile_market_cap) ?? toInteger(universeRow?.market_cap) ?? null,
    sector: detailRow?.profile_sector || detailRow?.quote_sector || universeRow?.sector || null,
    floatShares: toInteger(detailRow?.profile_float_shares) ?? toInteger(detailRow?.metric_float_shares) ?? null,
  };
}

function buildTickerContext(universeRow, marketData, marketContext) {
  const sectorSymbol = mapSectorToEtf(marketData.sector);
  const sectorEntry = sectorSymbol ? marketContext?.sectors?.[sectorSymbol] : null;
  return {
    sector: marketData.sector,
    sectorSymbol,
    sectorRank: sectorEntry?.rank ?? null,
    marketRegime: marketContext?.marketRegime || 'neutral',
    vixLevel: marketContext?.vix?.level || 'normal',
  };
}

function createTargets(currentPrice, premarketLow, premarketVwap) {
  const entry = toNumber(currentPrice);
  const low = toNumber(premarketLow);
  const vwap = toNumber(premarketVwap);
  if (entry === null || low === null) {
    return { stopIdea: null, firstTarget: null, invalidation: null };
  }

  const stopIdea = roundNumber(low * 0.995, 4);
  const risk = entry - stopIdea;
  const firstTarget = risk > 0 ? roundNumber(entry + risk * 2, 4) : null;

  return {
    stopIdea,
    firstTarget,
    invalidation: vwap !== null ? `Loss of premarket VWAP at $${vwap.toFixed(2)}` : null,
  };
}

async function loadActiveUniverse() {
  const result = await queryWithTimeout(
    `SELECT symbol, sector, market_cap
     FROM ticker_universe
     WHERE COALESCE(is_active, true) = true
       AND symbol IS NOT NULL
       AND BTRIM(symbol) <> ''`,
    [],
    { timeoutMs: 20000, label: 'premarket_model.load_universe', maxRetries: 0 }
  );

  return (result.rows || []).map((row) => ({
    symbol: String(row.symbol).trim().toUpperCase(),
    sector: row.sector || null,
    market_cap: toInteger(row.market_cap),
  }));
}

async function loadPremarketWindowMetrics(symbols, window) {
  const activityResult = await queryWithTimeout(
    `WITH window_bars AS (
       SELECT i.symbol, i.timestamp, i.high, i.low, i.close, i.volume
       FROM intraday_1m i
       WHERE i.session = 'PREMARKET'
         AND i.symbol = ANY($1::text[])
         AND i.timestamp >= $2::timestamptz
         AND i.timestamp <= $3::timestamptz
     ),
     ranked AS (
       SELECT
         symbol,
         timestamp,
         high,
         low,
         close,
         volume,
         ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY timestamp DESC) AS row_num
       FROM window_bars
     )
     SELECT
       symbol,
       SUM(volume)::bigint AS premarket_volume,
       MAX(high) AS premarket_high,
       MIN(low) AS premarket_low,
       CASE WHEN SUM(volume) > 0 THEN SUM(close * volume)::double precision / SUM(volume)::double precision ELSE NULL END AS premarket_vwap,
       MAX(timestamp) AS latest_timestamp,
       MAX(close) FILTER (WHERE row_num = 1) AS current_price,
       ARRAY_AGG(low ORDER BY timestamp DESC) FILTER (WHERE row_num <= 5) AS last5_lows,
       ARRAY_AGG(close ORDER BY timestamp DESC) FILTER (WHERE row_num <= 5) AS last5_closes,
       SUM(volume) FILTER (WHERE timestamp >= $4::timestamptz)::bigint AS last15_volume,
       COUNT(*)::integer AS bar_count
     FROM ranked
     GROUP BY symbol
     HAVING SUM(volume) > 0`,
    [symbols, window.windowStart.toISOString(), window.asOf.toISOString(), window.last15Start.toISOString()],
    { timeoutMs: 30000, label: 'premarket_model.window_metrics', maxRetries: 0 }
  );

  return {
    activityRows: activityResult.rows || [],
  };
}

async function loadPremarketBaselines(symbols, window) {
  if (!symbols.length) {
    return new Map();
  }

  const baselineResult = await queryWithTimeout(
    `WITH historical_window AS (
       SELECT
         i.symbol,
         DATE(i.timestamp) AS trading_date,
         SUM(i.volume)::bigint AS day_premarket_volume
       FROM intraday_1m i
       WHERE i.session = 'PREMARKET'
         AND i.symbol = ANY($1::text[])
         AND i.timestamp >= ($2::timestamptz - INTERVAL '45 days')
         AND i.timestamp <= $2::timestamptz
         AND (i.timestamp::time >= $3::time)
         AND (i.timestamp::time <= $4::time)
       GROUP BY i.symbol, DATE(i.timestamp)
     )
     SELECT
       symbol,
       AVG(day_premarket_volume)::bigint AS avg_premarket_volume_baseline,
       COUNT(*)::integer AS baseline_days
     FROM historical_window
     WHERE day_premarket_volume > 0
     GROUP BY symbol`,
    [symbols, window.asOf.toISOString(), formatTimeOfDay(window.windowStart), formatTimeOfDay(window.asOf)],
    { timeoutMs: 60000, label: 'premarket_model.window_baseline', maxRetries: 0 }
  );

  return mapRowsBySymbol(baselineResult.rows || []);
}

async function loadDetailRows(symbols, asOf) {
  const detailResult = await queryWithTimeout(
    `SELECT
       symbols.symbol,
       mq.previous_close,
       mq.market_cap AS quote_market_cap,
       mq.sector AS quote_sector,
       mm.previous_close AS metric_previous_close,
       mm.float_shares AS metric_float_shares,
       cp.market_cap AS profile_market_cap,
       cp.float_shares AS profile_float_shares,
       cp.sector AS profile_sector
     FROM UNNEST($1::text[]) AS symbols(symbol)
     LEFT JOIN market_quotes mq ON mq.symbol = symbols.symbol
     LEFT JOIN market_metrics mm ON mm.symbol = symbols.symbol
     LEFT JOIN company_profiles cp ON cp.symbol = symbols.symbol`,
    [symbols],
    { timeoutMs: 20000, label: 'premarket_model.detail_rows', maxRetries: 0 }
  );

  const newsResult = await queryWithTimeout(
    `SELECT symbol, headline, title, summary, body_text, source, publisher, published_at, published_date, catalyst_type, catalyst_cluster
     FROM news_articles
     WHERE symbol = ANY($1::text[])
       AND published_at >= ($2::timestamptz - INTERVAL '24 hours')
     ORDER BY published_at DESC`,
    [symbols, asOf.toISOString()],
    { timeoutMs: 25000, label: 'premarket_model.news_rows', maxRetries: 0 }
  );

  const filingsResult = await queryWithTimeout(
    `SELECT symbol, form_type, filing_date, accepted_date, catalyst_category, is_offering
     FROM sec_filings
     WHERE symbol = ANY($1::text[])
       AND COALESCE(accepted_date, filing_date) >= ($2::timestamptz - INTERVAL '24 hours')
     ORDER BY COALESCE(accepted_date, filing_date) DESC`,
    [symbols, asOf.toISOString()],
    { timeoutMs: 25000, label: 'premarket_model.sec_filings_rows', maxRetries: 0 }
  );

  const earningsResult = await queryWithTimeout(
    `SELECT symbol, report_date, report_time, time, company
     FROM earnings_events
     WHERE symbol = ANY($1::text[])
       AND report_date BETWEEN (($2::timestamptz AT TIME ZONE 'America/New_York')::date)
                          AND ((($2::timestamptz AT TIME ZONE 'America/New_York')::date) + 1)
     ORDER BY report_date ASC`,
    [symbols, asOf.toISOString()],
    { timeoutMs: 25000, label: 'premarket_model.earnings_rows', maxRetries: 0 }
  );

  return {
    detailMap: mapRowsBySymbol(detailResult.rows || []),
    newsMap: groupBySymbol(newsResult.rows || []),
    filingsMap: groupBySymbol(filingsResult.rows || []),
    earningsMap: groupBySymbol(earningsResult.rows || []),
  };
}

function buildPickRow({
  symbol,
  generatedAt,
  marketData,
  context,
  metrics,
  components,
  catalyst,
  label,
  riskFlags,
  structureType,
  tradeState,
  why,
}) {
  const targets = createTargets(metrics.currentPrice, metrics.premarketLow, metrics.premarketVwap);
  const generatedDate = new Date(generatedAt);

  return {
    symbol,
    generated_at: generatedAt,
    generator: GENERATOR,
    score: roundNumber(components.compositeScore, 2),
    label,
    structure_type: structureType,
    trade_state: tradeState,
    catalyst_score: roundNumber(components.catalystScore, 2),
    gap_score: roundNumber(components.gapScore, 2),
    volume_score: roundNumber(components.volumeScore, 2),
    structure_score: roundNumber(components.structureScore, 2),
    regime_score: roundNumber(components.regimeScore, 2),
    catalyst_type: catalyst.type,
    catalyst_summary: catalyst.summary,
    catalyst_timestamp: catalyst.timestamp ? catalyst.timestamp.toISOString() : null,
    catalyst_source: catalyst.source,
    pick_price: roundNumber(metrics.currentPrice, 4),
    previous_close: roundNumber(marketData.previousClose, 4),
    gap_percent: roundNumber(metrics.gapPercent, 4),
    premarket_volume: toInteger(metrics.premarketVolume),
    premarket_volume_baseline: toInteger(metrics.premarketVolumeBaseline),
    rvol: roundNumber(metrics.rvol, 4),
    premarket_high: roundNumber(metrics.premarketHigh, 4),
    premarket_low: roundNumber(metrics.premarketLow, 4),
    premarket_vwap: roundNumber(metrics.premarketVwap, 4),
    above_vwap: Boolean(metrics.aboveVwap),
    near_high: Boolean(metrics.nearHigh),
    market_cap: toInteger(marketData.marketCap),
    float_shares: toInteger(marketData.floatShares),
    sector: marketData.sector,
    sector_rank: toInteger(context.sectorRank),
    market_regime: context.marketRegime,
    vix_level: context.vixLevel,
    risk_flags: riskFlags,
    why,
    stop_idea: targets.stopIdea,
    first_target: targets.firstTarget,
    invalidation: targets.invalidation,
    outcome_status: 'pending',
    outcome_complete: false,
    outcome_t1_due_at: addMinutes(generatedDate, DUE_MINUTES[0]).toISOString(),
    outcome_t2_due_at: addMinutes(generatedDate, DUE_MINUTES[1]).toISOString(),
    outcome_t3_due_at: addMinutes(generatedDate, DUE_MINUTES[2]).toISOString(),
    outcome_t4_due_at: addMinutes(generatedDate, DUE_MINUTES[3]).toISOString(),
  };
}

async function insertPremarketPicks(rows) {
  if (!rows.length) return 0;

  await queryWithTimeout(
    `INSERT INTO premarket_picks (
       symbol,
       generated_at,
       generator,
       score,
       label,
       structure_type,
       trade_state,
       catalyst_score,
       gap_score,
       volume_score,
       structure_score,
       regime_score,
       catalyst_type,
       catalyst_summary,
       catalyst_timestamp,
       catalyst_source,
       pick_price,
       previous_close,
       gap_percent,
       premarket_volume,
       premarket_volume_baseline,
       rvol,
       premarket_high,
       premarket_low,
       premarket_vwap,
       above_vwap,
       near_high,
       market_cap,
       float_shares,
       sector,
       sector_rank,
       market_regime,
       vix_level,
       risk_flags,
       why,
       stop_idea,
       first_target,
       invalidation,
       outcome_status,
       outcome_complete,
       outcome_t1_due_at,
       outcome_t2_due_at,
       outcome_t3_due_at,
       outcome_t4_due_at
     )
     SELECT
       payload.symbol,
       payload.generated_at::timestamptz,
       payload.generator,
       payload.score::numeric,
       payload.label,
       payload.structure_type,
       payload.trade_state,
       payload.catalyst_score::numeric,
       payload.gap_score::numeric,
       payload.volume_score::numeric,
       payload.structure_score::numeric,
       payload.regime_score::numeric,
       payload.catalyst_type,
       payload.catalyst_summary,
       payload.catalyst_timestamp::timestamptz,
       payload.catalyst_source,
       payload.pick_price::numeric,
       payload.previous_close::numeric,
       payload.gap_percent::numeric,
       payload.premarket_volume::bigint,
       payload.premarket_volume_baseline::bigint,
       payload.rvol::numeric,
       payload.premarket_high::numeric,
       payload.premarket_low::numeric,
       payload.premarket_vwap::numeric,
       payload.above_vwap::boolean,
       payload.near_high::boolean,
       payload.market_cap::bigint,
       payload.float_shares::bigint,
       payload.sector,
       payload.sector_rank::integer,
       payload.market_regime,
       payload.vix_level,
       payload.risk_flags::jsonb,
       payload.why::jsonb,
       payload.stop_idea::numeric,
       payload.first_target::numeric,
       payload.invalidation,
       payload.outcome_status,
       payload.outcome_complete::boolean,
       payload.outcome_t1_due_at::timestamptz,
       payload.outcome_t2_due_at::timestamptz,
       payload.outcome_t3_due_at::timestamptz,
       payload.outcome_t4_due_at::timestamptz
     FROM json_to_recordset($1::json) AS payload(
       symbol text,
       generated_at text,
       generator text,
       score numeric,
       label text,
       structure_type text,
       trade_state text,
       catalyst_score numeric,
       gap_score numeric,
       volume_score numeric,
       structure_score numeric,
       regime_score numeric,
       catalyst_type text,
       catalyst_summary text,
       catalyst_timestamp text,
       catalyst_source text,
       pick_price numeric,
       previous_close numeric,
       gap_percent numeric,
       premarket_volume bigint,
       premarket_volume_baseline bigint,
       rvol numeric,
       premarket_high numeric,
       premarket_low numeric,
       premarket_vwap numeric,
       above_vwap boolean,
       near_high boolean,
       market_cap bigint,
       float_shares bigint,
       sector text,
       sector_rank integer,
       market_regime text,
       vix_level text,
       risk_flags jsonb,
       why jsonb,
       stop_idea numeric,
       first_target numeric,
       invalidation text,
       outcome_status text,
       outcome_complete boolean,
       outcome_t1_due_at text,
       outcome_t2_due_at text,
       outcome_t3_due_at text,
       outcome_t4_due_at text
     )
     ON CONFLICT (symbol, generated_at, generator) DO UPDATE SET
       score = EXCLUDED.score,
       label = EXCLUDED.label,
       structure_type = EXCLUDED.structure_type,
       trade_state = EXCLUDED.trade_state,
       catalyst_score = EXCLUDED.catalyst_score,
       gap_score = EXCLUDED.gap_score,
       volume_score = EXCLUDED.volume_score,
       structure_score = EXCLUDED.structure_score,
       regime_score = EXCLUDED.regime_score,
       catalyst_type = EXCLUDED.catalyst_type,
       catalyst_summary = EXCLUDED.catalyst_summary,
       catalyst_timestamp = EXCLUDED.catalyst_timestamp,
       catalyst_source = EXCLUDED.catalyst_source,
       pick_price = EXCLUDED.pick_price,
       previous_close = EXCLUDED.previous_close,
       gap_percent = EXCLUDED.gap_percent,
       premarket_volume = EXCLUDED.premarket_volume,
       premarket_volume_baseline = EXCLUDED.premarket_volume_baseline,
       rvol = EXCLUDED.rvol,
       premarket_high = EXCLUDED.premarket_high,
       premarket_low = EXCLUDED.premarket_low,
       premarket_vwap = EXCLUDED.premarket_vwap,
       above_vwap = EXCLUDED.above_vwap,
       near_high = EXCLUDED.near_high,
       market_cap = EXCLUDED.market_cap,
       float_shares = EXCLUDED.float_shares,
       sector = EXCLUDED.sector,
       sector_rank = EXCLUDED.sector_rank,
       market_regime = EXCLUDED.market_regime,
       vix_level = EXCLUDED.vix_level,
       risk_flags = EXCLUDED.risk_flags,
       why = EXCLUDED.why,
       stop_idea = EXCLUDED.stop_idea,
       first_target = EXCLUDED.first_target,
       invalidation = EXCLUDED.invalidation,
       outcome_status = EXCLUDED.outcome_status,
       outcome_complete = EXCLUDED.outcome_complete,
       outcome_t1_due_at = EXCLUDED.outcome_t1_due_at,
       outcome_t2_due_at = EXCLUDED.outcome_t2_due_at,
       outcome_t3_due_at = EXCLUDED.outcome_t3_due_at,
       outcome_t4_due_at = EXCLUDED.outcome_t4_due_at`,
    [JSON.stringify(rows)],
    { timeoutMs: 45000, label: 'premarket_model.insert_picks', maxRetries: 0, poolType: 'write' }
  );

  return rows.length;
}

async function runPremarketCatalystModel(options = {}) {
  const startedAt = Date.now();
  const asOf = normalizeAsOf(options.asOf);
  const generatedAt = asOf.toISOString();
  const dryRun = Boolean(options.dryRun);

  logger.info('premarket catalyst model start', {
    jobName: 'premarket_catalyst_model',
    asOf: generatedAt,
    dryRun,
  });

  const marketContext = await getMarketContext();
  const universeRows = await loadActiveUniverse();
  const universeMap = mapRowsBySymbol(universeRows);
  const window = computeWindow(asOf);

  const { activityRows } = await loadPremarketWindowMetrics(universeRows.map((row) => row.symbol), window);
  const scoredSymbols = activityRows.map((row) => row.symbol);

  if (scoredSymbols.length === 0) {
    throw new Error('No symbols with premarket activity in the scoring window');
  }

  const baselineMap = await loadPremarketBaselines(scoredSymbols, window);

  const { detailMap, newsMap, filingsMap, earningsMap } = await loadDetailRows(scoredSymbols, asOf);
  const labels = { A: 0, B: 0, C: 0 };
  const errors = [];
  const pickRows = [];

  for (const activityRow of activityRows) {
    const symbolStartedAt = Date.now();
    try {
      const symbol = String(activityRow.symbol).trim().toUpperCase();
      const universeRow = universeMap.get(symbol) || { symbol };
      const detailRow = detailMap.get(symbol) || null;
      const marketData = pickMarketData(universeRow, detailRow);
      const baselineRow = baselineMap.get(symbol) || null;
      const newsArticles = newsMap.get(symbol) || [];
      const secFilings = filingsMap.get(symbol) || [];
      const earningsEvents = earningsMap.get(symbol) || [];
      const premarketBars = buildPremarketBars(activityRow);
      const currentPrice = toNumber(activityRow.current_price);
      const premarketVwap = toNumber(activityRow.premarket_vwap);
      const premarketHigh = toNumber(activityRow.premarket_high);
      const premarketLow = toNumber(activityRow.premarket_low);
      const premarketVolume = toInteger(activityRow.premarket_volume);
      const baseline = toInteger(baselineRow?.avg_premarket_volume_baseline);
      const rvol = baseline && baseline > 0 && premarketVolume ? premarketVolume / baseline : null;
      const aboveVwap = currentPrice !== null && premarketVwap !== null ? currentPrice >= premarketVwap : false;
      const nearHigh = currentPrice !== null && premarketHigh !== null && premarketHigh > 0 ? currentPrice >= premarketHigh * 0.99 : false;
      const gapPercent = currentPrice !== null && marketData.previousClose ? ((currentPrice - marketData.previousClose) / marketData.previousClose) * 100 : null;
      const context = buildTickerContext(universeRow, marketData, marketContext);
      const catalyst = deriveCatalystSignal({ newsArticles, secFilings, earningsEvents, now: asOf });

      const components = {
        catalystScore: scoreCatalyst({ newsArticles, secFilings, earningsEvents, now: asOf }),
        gapScore: scoreGap({ premarketPrice: currentPrice, previousClose: marketData.previousClose }),
        volumeScore: scoreVolume({ premarketVolume, premarketVolumeBaseline: baseline }),
        structureScore: scoreStructure({ premarketBars, premarketHigh, premarketVwap, currentPrice }),
        regimeScore: scoreRegime({ marketContext, ticker: { sectorSymbol: context.sectorSymbol } }),
      };
      components.compositeScore = computeCompositeScore(components);

      const metrics = {
        currentPrice,
        premarketHigh,
        premarketLow,
        premarketVwap,
        premarketVolume,
        premarketVolumeBaseline: baseline,
        baselineDays: toInteger(baselineRow?.baseline_days),
        rvol,
        aboveVwap,
        nearHigh,
        gapPercent,
        marketCap: marketData.marketCap,
        floatShares: marketData.floatShares,
        sectorRank: context.sectorRank,
        catalystScore: components.catalystScore,
        last15VolumeShare: premarketVolume ? (toInteger(activityRow.last15_volume) || 0) / premarketVolume : 0,
      };

      const riskFlags = generateRiskFlags({ metrics, context, secFilings, news: newsArticles, marketContext });
      const structureType = deriveStructureType({ components, metrics });
      const label = classifyLabel({ score: components.compositeScore, components, metrics, riskFlags });
      const tradeState = deriveTradeState({ label, structureType, metrics });
      const why = generateWhy({ components, metrics, context: { catalyst, marketRegime: context.marketRegime }, structureType });

      labels[label] += 1;
      pickRows.push(buildPickRow({
        symbol,
        generatedAt,
        marketData,
        context,
        metrics,
        components,
        catalyst,
        label,
        riskFlags,
        structureType,
        tradeState,
        why,
      }));
    } catch (error) {
      errors.push({ symbol: activityRow.symbol, error: error.message });
    }

    const perSymbolRuntime = Date.now() - symbolStartedAt;
    if (perSymbolRuntime > MAX_SYMBOL_RUNTIME_MS) {
      throw new Error(`Ticker scoring exceeded ${MAX_SYMBOL_RUNTIME_MS}ms for ${activityRow.symbol}`);
    }
  }

  if (!dryRun) {
    await insertPremarketPicks(pickRows);
  }

  const result = {
    generatedAt,
    asOf: generatedAt,
    symbolsScored: pickRows.length,
    symbolsSkipped: universeRows.length - pickRows.length,
    labelsA: labels.A,
    labelsB: labels.B,
    labelsC: labels.C,
    durationMs: Date.now() - startedAt,
    errors,
  };

  logger.info('premarket catalyst model done', {
    jobName: 'premarket_catalyst_model',
    ...result,
    dryRun,
  });

  return result;
}

module.exports = {
  GENERATOR,
  runPremarketCatalystModel,
};
