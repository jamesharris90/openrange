const { fetchStockList } = require('../services/fmpService');
const { enrichFundamentals } = require('./fundamentalsEnricher');
const { calculateTechnicals } = require('./technicalCalculator');
const { processNews } = require('./newsProcessor');
const { buildCatalysts } = require('./catalystEngine');
const { buildEarningsMap } = require('./earningsEngine');
const { buildAnalystMap } = require('./analystEngine');
const { buildStrategyFlags } = require('./strategyEngine');
const { buildComputedSignals } = require('./computedSignals');
const cache = require('./cacheManager');

let inFlight = {
  universe: false,
  fundamentals: false,
  technicals: false,
  news: false,
  earnings: false,
  analysts: false,
};

function withLock(key, task, logger = console) {
  return async () => {
    if (inFlight[key]) return;
    inFlight[key] = true;
    try {
      await task();
    } catch (err) {
      logger.error(`Data-engine task failed: ${key}`, { error: err.message });
    } finally {
      inFlight[key] = false;
    }
  };
}

async function refreshUniverse(apiKey, logger = console) {
  const universe = await fetchStockList();
  if (Array.isArray(universe) && universe.length) {
    cache.setBaseUniverse(universe);
  }
  return cache.getBaseUniverse();
}

async function refreshFundamentals(apiKey, logger = console) {
  const universe = cache.getBaseUniverse();
  if (!universe.length) return;
  const fundamentals = await enrichFundamentals(universe, apiKey, logger);
  cache.setDataset('fundamentals', fundamentals);
}

async function refreshEarnings(apiKey, logger = console) {
  const universe = cache.getBaseUniverse();
  if (!universe.length) return;
  const map = await buildEarningsMap(universe, apiKey, logger);
  cache.setDataset('earnings', map);
}

async function refreshAnalysts(logger = console) {
  const universe = cache.getBaseUniverse();
  if (!universe.length) return;
  const map = buildAnalystMap(universe, logger);
  cache.setDataset('analysts', map);
}

async function refreshNews(apiKey, logger = console) {
  const universe = cache.getBaseUniverse();
  if (!universe.length) return;
  const map = await processNews(universe, apiKey, logger);
  cache.setDataset('news', map);
}

async function refreshTechnicals(logger = console) {
  const universe = cache.getBaseUniverse();
  if (!universe.length) return;
  const map = await calculateTechnicals(universe, logger);
  cache.setDataset('technicals', map);
}

function refreshDerived(logger = console) {
  const universe = cache.getBaseUniverse();
  if (!universe.length) return;

  const merged = cache.mergeMasterDataset();
  const mergedMap = new Map(merged.map((r) => [r.symbol, r]));

  const catalysts = buildCatalysts(
    universe,
    cache.getDataset('news') || new Map(),
    cache.getDataset('earnings') || new Map(),
    logger
  );
  cache.setDataset('catalysts', catalysts);

  const strategy = buildStrategyFlags(Array.from(mergedMap.values()), logger);
  cache.setDataset('strategy', strategy);

  const withStrategy = cache.mergeMasterDataset();
  const computed = buildComputedSignals(withStrategy, logger);
  cache.setDataset('computed', computed);

  cache.mergeMasterDataset();
}

async function rebuildEngine(apiKey, logger = console) {
  await refreshUniverse(apiKey, logger);
  await Promise.all([
    refreshFundamentals(apiKey, logger),
    refreshEarnings(apiKey, logger),
    refreshAnalysts(logger),
    refreshNews(apiKey, logger),
    refreshTechnicals(logger),
  ]);
  refreshDerived(logger);
  return cache.getEnrichedUniverse();
}

function startScheduler(apiKey, logger = console) {
  const runUniverse = withLock('universe', () => refreshUniverse(apiKey, logger), logger);
  const runFundamentals = withLock('fundamentals', () => refreshFundamentals(apiKey, logger), logger);
  const runTechnicals = withLock('technicals', () => refreshTechnicals(logger), logger);
  const runNews = withLock('news', () => refreshNews(apiKey, logger), logger);
  const runEarnings = withLock('earnings', () => refreshEarnings(apiKey, logger), logger);
  const runAnalysts = withLock('analysts', () => refreshAnalysts(logger), logger);

  runUniverse().then(() => Promise.all([runFundamentals(), runEarnings(), runAnalysts(), runNews(), runTechnicals()]).then(() => refreshDerived(logger)));

  setInterval(runUniverse, 24 * 60 * 60 * 1000);
  setInterval(runFundamentals, 24 * 60 * 60 * 1000);
  setInterval(runEarnings, 24 * 60 * 60 * 1000);
  setInterval(runAnalysts, 24 * 60 * 60 * 1000);
  setInterval(async () => {
    await runTechnicals();
    refreshDerived(logger);
  }, 2 * 60 * 1000);
  setInterval(async () => {
    await runNews();
    refreshDerived(logger);
  }, 5 * 60 * 1000);

  logger.info('Data engine scheduler started');
}

module.exports = {
  startScheduler,
  rebuildEngine,
};
