/**
 * newsService.js
 *
 * Scoped news refresh — only processes news for symbols inside the active
 * preset universe + watchlist. Never fetches news for the full 15k universe.
 */

const { processNews } = require('../data-engine/newsProcessor');
const cacheManager = require('../data-engine/cacheManager');

/**
 * Refresh news data scoped to the given preset + watchlist symbols.
 *
 * @param {string[]} presetSymbols    - symbols from the active preset universe
 * @param {string[]} watchlistSymbols - watchlist symbols
 * @param {string}   apiKey
 * @param {object}   logger
 */
async function refreshScopedNews(presetSymbols, watchlistSymbols, apiKey, logger = console) {
  const scopedSet = new Set([
    ...presetSymbols.map((s) => String(s).toUpperCase()),
    ...watchlistSymbols.map((s) => String(s).toUpperCase()),
  ]);

  const baseUniverse = cacheManager.getBaseUniverse();
  const scoped = baseUniverse.filter((row) => scopedSet.has(String(row.symbol || '').toUpperCase()));

  if (!scoped.length) {
    logger.warn('newsService: no symbols in scope for news refresh');
    return new Map();
  }

  logger.info('newsService: refreshing scoped news', {
    scopedCount: scoped.length,
    presetCount: presetSymbols.length,
    watchlistCount: watchlistSymbols.length,
  });

  const map = await processNews(scoped, apiKey, logger);
  cacheManager.setDataset('news', map);
  return map;
}

module.exports = { refreshScopedNews };
