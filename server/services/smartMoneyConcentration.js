const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const CACHE_TTL_MS = 30 * 60 * 1000;

const symbolCache = new Map();

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getCachedValue(symbol) {
  const cached = symbolCache.get(symbol);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    symbolCache.delete(symbol);
    return undefined;
  }
  return cached.value;
}

function setCachedValue(symbol, value) {
  symbolCache.set(symbol, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function getSmartMoneyConcentration(symbols) {
  const normalizedSymbols = [...new Set((symbols || []).map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean))];
  const result = new Map();
  const missing = [];

  normalizedSymbols.forEach((symbol) => {
    const cachedValue = getCachedValue(symbol);
    if (cachedValue === undefined) {
      missing.push(symbol);
      return;
    }
    if (cachedValue !== null) {
      result.set(symbol, cachedValue);
    }
  });

  if (missing.length === 0) {
    return result;
  }

  try {
    const queryResult = await queryWithTimeout(
      `
        SELECT symbol, total_score
        FROM smart_money_scores
        WHERE score_date = CURRENT_DATE
          AND symbol = ANY($1::text[])
      `,
      [missing],
      {
        label: 'calendar.smart_money.current',
        timeoutMs: 8000,
        maxRetries: 1,
        poolType: 'read',
      },
    );

    const foundSymbols = new Set();
    queryResult.rows.forEach((row) => {
      const symbol = String(row.symbol || '').trim().toUpperCase();
      const totalScore = toFiniteNumber(row.total_score);
      foundSymbols.add(symbol);

      if (totalScore !== null && totalScore > 0) {
        const concentration = Math.min(5, Math.ceil(totalScore / 20));
        result.set(symbol, concentration);
        setCachedValue(symbol, concentration);
      } else {
        setCachedValue(symbol, null);
      }
    });

    missing.forEach((symbol) => {
      if (!foundSymbols.has(symbol)) {
        setCachedValue(symbol, null);
      }
    });
  } catch (error) {
    logger.warn('failed to load smart money concentration data', { error: error.message, symbols: missing.length });
  }

  return result;
}

module.exports = {
  getSmartMoneyConcentration,
};