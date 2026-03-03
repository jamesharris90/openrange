/**
 * enrichmentPipeline.js
 *
 * Orchestrates the four data layers:
 *   A  — Full Universe         (daily ~04:00 UK)  fetchStockList (binary cap-split)
 *   B  — Fundamentals          (daily)            enrichFundamentals, earnings, analysts
 *   C  — Operational Quotes    (rolling)          quoteService scoped to operationalUniverse + watchlist
 *   D  — News + Derived        (frequent)         newsService + catalysts/strategy/computed
 *   T3 — Full Universe Quotes  (12-24h overnight) quoteService over all ~15k symbols
 *
 * Two universe layers:
 *   fullUniverse         — all actively-trading US equities (~15k), stored as baseUniverse.
 *                          FMP API already filters isActivelyTrading=true, isEtf=false, isFund=false.
 *   operationalUniverse  — fullUniverse filtered by user preset (price, cap, sector, etc.)
 *                          + baseline warrant/SPAC exclusions. Receives high-frequency quote updates.
 *
 * Called by phaseScheduler. All functions update cacheManager in place.
 */

const { fetchStockList } = require('./fmpService');
const { enrichFundamentals } = require('../data-engine/fundamentalsEnricher');
const { calculateTechnicals } = require('../data-engine/technicalCalculator');
const { buildCatalysts } = require('../data-engine/catalystEngine');
const { buildEarningsMap } = require('../data-engine/earningsEngine');
const { buildAnalystMap } = require('../data-engine/analystEngine');
const { buildStrategyFlags } = require('../data-engine/strategyEngine');
const { buildComputedSignals } = require('../data-engine/computedSignals');
const { classifyStructures } = require('../data-engine/structureClassifier');
const { enrichHistorical } = require('../data-engine/yahooHistoricalEnricher');
const { applyFilters } = require('../data-engine/filterEngine');
const { fetchQuotesForSymbols, refreshPresetQuotes } = require('./quoteService');
const { refreshScopedNews } = require('./newsService');
const cacheManager = require('../data-engine/cacheManager');

// Warrant-like symbol suffixes to exclude from operational universe.
// Only applied to symbols of 5+ characters: real stocks like PLTR (ends R),
// SCHW (ends W), MANU (ends U) are 4 chars and must NOT be excluded.
// SPAC warrants/units/rights are typically 5-char: e.g. ACAHW, ACMRW, PNTMR.
const WARRANT_SUFFIXES = ['W', 'U', 'R'];
const SPAC_KEYWORDS = ['acquisition corp', 'blank check', 'spac'];

function _isWarrant(symbol = '') {
  const s = String(symbol).toUpperCase();
  // Require 5+ chars to distinguish warrants (ABCDW) from real stocks (SCHW, PLTR)
  if (s.length < 5) return false;
  return WARRANT_SUFFIXES.some((sfx) => s.endsWith(sfx)) || s.includes('-P');
}

function _isSpac(name = '') {
  const n = String(name).toLowerCase();
  return SPAC_KEYWORDS.some((kw) => n.includes(kw));
}

// ---------------------------------------------------------------------------
// Layer A — Full Universe (daily ~04:00 UK)
// ---------------------------------------------------------------------------

async function refreshLayerA(logger = console) {
  logger.info('enrichmentPipeline: Layer A — fetching full universe');
  try {
    const stocks = await fetchStockList();
    if (Array.isArray(stocks) && stocks.length) {
      cacheManager.setBaseUniverse(stocks);
      logger.info('enrichmentPipeline: Layer A complete', { fullUniverseCount: stocks.length });
    } else {
      logger.warn('enrichmentPipeline: Layer A returned no stocks; retaining existing universe');
    }
    return cacheManager.getBaseUniverse();
  } catch (err) {
    logger.error('enrichmentPipeline: Layer A failed', { error: err.message });
    return cacheManager.getBaseUniverse();
  }
}

// ---------------------------------------------------------------------------
// Layer B — Fundamentals (daily)
// ---------------------------------------------------------------------------

async function refreshLayerB(apiKey, logger = console) {
  const universe = cacheManager.getBaseUniverse();
  if (!universe.length) {
    logger.warn('enrichmentPipeline: Layer B skipped — full universe is empty');
    return;
  }

  logger.info('enrichmentPipeline: Layer B — enriching fundamentals', { count: universe.length });
  try {
    const [fundamentals, earnings] = await Promise.all([
      enrichFundamentals(universe, apiKey, logger),
      buildEarningsMap(universe, apiKey, logger),
    ]);
    const analysts = buildAnalystMap(universe, logger);

    cacheManager.setDataset('fundamentals', fundamentals);
    cacheManager.setDataset('earnings', earnings);
    cacheManager.setDataset('analysts', analysts);

    logger.info('enrichmentPipeline: Layer B complete');
  } catch (err) {
    logger.error('enrichmentPipeline: Layer B failed', { error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Layer B2 — Yahoo Finance Historical Data (daily, once per prescan)
// Fetches: 90-day OHLCV (closeSeries/bars) for technicals, floatShares,
// avgVolume30d, intraday VWAP, opening range high/low.
// Requires operationalUniverse to be populated (run after Layer C first time,
// then daily thereafter).
// ---------------------------------------------------------------------------

async function refreshLayerB2(logger = console) {
  const operational = cacheManager.getDataset('operationalUniverse') || [];
  if (!operational.length) {
    logger.warn('enrichmentPipeline: Layer B2 skipped — operationalUniverse is empty');
    return;
  }

  const symbols = operational.map((r) => r.symbol).filter(Boolean);
  logger.info('enrichmentPipeline: Layer B2 — fetching Yahoo historical data', { symbols: symbols.length });

  try {
    const historicalMap = await enrichHistorical(symbols, logger);
    cacheManager.setDataset('historical', historicalMap);
    logger.info('enrichmentPipeline: Layer B2 complete', { enriched: historicalMap.size });

    // Re-run technicals now that we have closeSeries + intraday bars
    const enriched = cacheManager.mergeMasterDataset();
    const hist = historicalMap;
    const enrichedWithHistory = enriched.map((row) => {
      const h = hist.get(row.symbol) || {};
      return { ...row, closeSeries: h.closeSeries || [], bars: h.bars || [] };
    });
    const technicals = await calculateTechnicals(enrichedWithHistory, logger);
    cacheManager.setDataset('technicals', technicals);
    cacheManager.mergeMasterDataset();

    logger.info('enrichmentPipeline: Layer B2 technicals recalculated');
  } catch (err) {
    logger.error('enrichmentPipeline: Layer B2 failed', { error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Layer C — Operational + Watchlist Quotes (Tier 1 + Tier 2 rolling)
// ---------------------------------------------------------------------------

async function refreshLayerC(apiKey, operationalSymbols, watchlistSymbols, logger = console) {
  logger.info('enrichmentPipeline: Layer C — refreshing operational quotes', {
    operationalCount: operationalSymbols.length,
    watchlistCount: watchlistSymbols.length,
  });

  try {
    await refreshPresetQuotes(operationalSymbols, watchlistSymbols, apiKey, logger);

    // Run technicals on QUOTE-ENRICHED rows. Also inject closeSeries + intraday bars
    // from Layer B2 historical data so that EMA/RSI/ATR/VWAP calculations work.
    const enriched = cacheManager.mergeMasterDataset();
    const historical = cacheManager.getDataset('historical') || new Map();
    const enrichedWithHistory = enriched.map((row) => {
      const h = historical.get(row.symbol) || {};
      return { ...row, closeSeries: h.closeSeries || [], bars: h.bars || [] };
    });
    const technicals = await calculateTechnicals(enrichedWithHistory, logger);
    cacheManager.setDataset('technicals', technicals);

    logger.info('enrichmentPipeline: Layer C complete', {
      quotesInCache: (cacheManager.getDataset('quotes') || new Map()).size,
    });
  } catch (err) {
    logger.error('enrichmentPipeline: Layer C failed', { error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Layer D — News + Derived Signals (frequent)
// ---------------------------------------------------------------------------

async function refreshLayerD(apiKey, operationalSymbols, watchlistSymbols, logger = console) {
  logger.info('enrichmentPipeline: Layer D — news + derived signals');
  try {
    await refreshScopedNews(operationalSymbols, watchlistSymbols, apiKey, logger);
    _rebuildDerived(logger);
    logger.info('enrichmentPipeline: Layer D complete');
  } catch (err) {
    logger.error('enrichmentPipeline: Layer D failed', { error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — Full Universe Quote Refresh (12-24h, overnight only)
// Refreshes quotes for all ~15k fullUniverse symbols.
// Uses the same token-bucket (5 calls/sec) — ~50 min for 15k symbols.
// Should run only during overnight phase to avoid competing with Tier 1/2.
// Merges in-place; never shrinks fullUniverse.
// ---------------------------------------------------------------------------

async function refreshTier3Quotes(apiKey, logger = console) {
  const fullUniverse = cacheManager.getBaseUniverse();
  if (!fullUniverse.length) {
    logger.warn('enrichmentPipeline: Tier 3 skipped — full universe is empty');
    return;
  }

  logger.info('enrichmentPipeline: Tier 3 — full universe quote refresh starting', {
    symbolCount: fullUniverse.length,
    estimatedMinutes: Math.ceil(fullUniverse.length / 5 / 60),
  });

  const symbols = fullUniverse.map((r) => r.symbol);
  // Enable incremental flush so screener shows partial data every 200 symbols
  const quotesMap = await fetchQuotesForSymbols(symbols, apiKey, logger, true);

  // Merge new quotes into existing cache (never discard existing data)
  const existing = cacheManager.getDataset('quotes') || new Map();
  for (const [sym, quote] of quotesMap) {
    existing.set(sym, quote);
  }
  cacheManager.setDataset('quotes', existing);

  _rebuildDerived(logger);

  logger.info('enrichmentPipeline: Tier 3 complete', {
    quotesReceived: quotesMap.size,
    totalQuotesCached: existing.size,
  });
}

// ---------------------------------------------------------------------------
// Internal: rebuild catalyst / strategy / computed signals
// ---------------------------------------------------------------------------

function _rebuildDerived(logger = console) {
  const universe = cacheManager.getBaseUniverse();
  if (!universe.length) return;

  const merged = cacheManager.mergeMasterDataset();
  const mergedMap = new Map(merged.map((r) => [r.symbol, r]));

  const catalysts = buildCatalysts(
    universe,
    cacheManager.getDataset('news') || new Map(),
    cacheManager.getDataset('earnings') || new Map(),
    logger
  );
  cacheManager.setDataset('catalysts', catalysts);

  const strategy = buildStrategyFlags(Array.from(mergedMap.values()), logger);
  cacheManager.setDataset('strategy', strategy);

  const withStrategy = cacheManager.mergeMasterDataset();
  const computed = buildComputedSignals(withStrategy, logger);
  cacheManager.setDataset('computed', computed);

  // Structure classification runs last — needs strategy flags + computed signals
  const withComputed = cacheManager.mergeMasterDataset();
  const structures = classifyStructures(withComputed, logger);
  cacheManager.setDataset('structures', structures);

  cacheManager.mergeMasterDataset();
}

// ---------------------------------------------------------------------------
// Full rebuild — used by /api/data/sync
// ---------------------------------------------------------------------------

async function rebuildAll(apiKey, operationalSymbols = [], watchlistSymbols = [], logger = console) {
  logger.info('enrichmentPipeline: full rebuild starting');

  await refreshLayerA(logger);
  await refreshLayerB(apiKey, logger);

  const { symbols: opSymbols } = operationalSymbols.length
    ? { symbols: operationalSymbols }
    : computeOperationalUniverse(null);

  await refreshLayerC(apiKey, opSymbols, watchlistSymbols, logger);
  await refreshLayerD(apiKey, opSymbols, watchlistSymbols, logger);

  logger.info('enrichmentPipeline: full rebuild complete', {
    fullUniverseCount: cacheManager.getBaseUniverse().length,
    enrichedCount: cacheManager.getEnrichedUniverse().length,
  });

  return cacheManager.getEnrichedUniverse();
}

// ---------------------------------------------------------------------------
// Operational Universe computation
// Derives the operational trading universe from fullUniverse + user preset.
//
// Baseline filters (always applied regardless of preset):
//   - Warrant suffixes (W, U, R, -P) excluded
//   - SPACs excluded (unless preset.includeSpacs = true)
//   - ETFs/Funds excluded (unless preset.includeEtfs = true)
//     Note: fullUniverse already excludes most via FMP API params,
//     but local check is a safety net.
//
// Preset-driven filters (read from user's activeUniversePreset):
//   - minPrice / maxPrice   (e.g. $1–$40)
//   - minMarketCap / maxMarketCap
//   - exchanges             (subset of NASDAQ/NYSE/AMEX)
//   - sectors               (optional sector whitelist)
//
// Stores result in cacheManager 'operationalUniverse'.
// Returns { rows, symbols }.
// ---------------------------------------------------------------------------

function computeOperationalUniverse(preset) {
  const base = cacheManager.getBaseUniverse();

  if (!base.length) {
    return { rows: [], symbols: [] };
  }

  // Build filter payload for filterEngine
  const filterPayload = {};
  if (preset) {
    if (preset.minPrice != null)     filterPayload.minPrice     = preset.minPrice;
    if (preset.maxPrice != null)     filterPayload.maxPrice     = preset.maxPrice;
    if (preset.minMarketCap != null) filterPayload.minMarketCap = preset.minMarketCap;
    if (preset.maxMarketCap != null) filterPayload.maxMarketCap = preset.maxMarketCap;
    if (Array.isArray(preset.exchanges) && preset.exchanges.length) {
      filterPayload.exchanges = preset.exchanges;
    }
    if (Array.isArray(preset.sectors) && preset.sectors.length) {
      filterPayload.sectors = preset.sectors;
    }
  }

  const filtered = applyFilters(base, filterPayload);

  // Baseline exclusions
  const includeSpacs    = preset?.includeSpacs    ?? false;
  const includeWarrants = preset?.includeWarrants ?? false;
  const includeEtfs     = preset?.includeEtfs     ?? false;

  const result = filtered.filter((row) => {
    if (!includeWarrants && _isWarrant(row.symbol))                        return false;
    if (!includeSpacs    && _isSpac(row.companyName || row.name || ''))    return false;
    if (!includeEtfs     && (row.isEtf || row.isFund))                     return false;
    return true;
  });

  cacheManager.setDataset('operationalUniverse', result);

  return {
    rows: result,
    symbols: result.map((r) => r.symbol),
  };
}

module.exports = {
  refreshLayerA,
  refreshLayerB,
  refreshLayerB2,
  refreshLayerC,
  refreshLayerD,
  refreshTier3Quotes,
  rebuildAll,
  computeOperationalUniverse,
};
