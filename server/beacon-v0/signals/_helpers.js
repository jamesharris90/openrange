function queryWithTimeout(...args) {
  return require('../../db/pg').queryWithTimeout(...args);
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeUniverse(universe) {
  if (!Array.isArray(universe)) return [];
  return [...new Set(universe.map(normalizeSymbol).filter(Boolean))];
}

function buildUniverseClause(universe, nextParamIndex) {
  const symbols = normalizeUniverse(universe);
  if (symbols.length === 0) {
    return { clause: '', params: [] };
  }

  return {
    clause: `AND UPPER(symbol) = ANY($${nextParamIndex}::text[])`,
    params: [symbols],
  };
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat('en-US').format(Math.round(numeric));
}

function createResultMap(rows, mapper) {
  const results = new Map();
  rows.forEach((row, index) => {
    const result = mapper(row, index);
    if (result?.symbol) {
      results.set(result.symbol, result);
    }
  });
  return results;
}

module.exports = {
  buildUniverseClause,
  createResultMap,
  formatNumber,
  normalizeSymbol,
  normalizeUniverse,
  queryWithTimeout,
  toNumber,
};