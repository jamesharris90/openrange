'use strict';

const { queryWithTimeout } = require('../../db/pg');

const TOLERANCE_MINUTES = 15;

function assertDate(value, label) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid Date`);
  }
}

function normalizeSymbol(symbol) {
  const value = String(symbol || '').trim().toUpperCase();
  if (!value) {
    throw new Error('symbol is required');
  }
  return value;
}

function normalizeBarType(barType) {
  if (barType !== 'open-like' && barType !== 'close-like') {
    throw new Error(`Unsupported barType: ${barType}`);
  }
  return barType;
}

async function lookupPrice(symbol, targetUTC, barType) {
  const normalizedSymbol = normalizeSymbol(symbol);
  assertDate(targetUTC, 'targetUTC');
  const normalizedBarType = normalizeBarType(barType);
  const toleranceMs = TOLERANCE_MINUTES * 60 * 1000;

  let intradayQuery;
  let intradayParams;
  if (normalizedBarType === 'open-like') {
    intradayQuery = `
      SELECT close AS price, volume, timestamp
      FROM intraday_1m
      WHERE symbol = $1
        AND timestamp >= $2
        AND timestamp <= $3
      ORDER BY timestamp ASC
      LIMIT 1
    `;
    intradayParams = [normalizedSymbol, targetUTC, new Date(targetUTC.getTime() + toleranceMs)];
  } else {
    intradayQuery = `
      SELECT close AS price, volume, timestamp
      FROM intraday_1m
      WHERE symbol = $1
        AND timestamp <= $2
        AND timestamp >= $3
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    intradayParams = [normalizedSymbol, targetUTC, new Date(targetUTC.getTime() - toleranceMs)];
  }

  const intradayResult = await queryWithTimeout(intradayQuery, intradayParams, {
    timeoutMs: 3000,
    slowQueryMs: 1000,
    label: 'beacon_v0.outcomes.price_lookup.intraday',
    poolType: 'read',
    maxRetries: 0,
  });

  if (intradayResult.rows.length > 0) {
    return {
      price: Number(intradayResult.rows[0].price),
      volume: intradayResult.rows[0].volume == null ? null : Number(intradayResult.rows[0].volume),
      captured_at: intradayResult.rows[0].timestamp,
      source: 'intraday',
    };
  }

  if (normalizedBarType === 'close-like') {
    const dateStr = targetUTC.toISOString().slice(0, 10);
    const dailyResult = await queryWithTimeout(
      `
        SELECT close AS price, volume, date
        FROM daily_ohlc
        WHERE symbol = $1
          AND date = $2
        LIMIT 1
      `,
      [normalizedSymbol, dateStr],
      {
        timeoutMs: 3000,
        slowQueryMs: 1000,
        label: 'beacon_v0.outcomes.price_lookup.daily',
        poolType: 'read',
        maxRetries: 0,
      },
    );

    if (dailyResult.rows.length > 0) {
      return {
        price: Number(dailyResult.rows[0].price),
        volume: dailyResult.rows[0].volume == null ? null : Number(dailyResult.rows[0].volume),
        captured_at: targetUTC,
        source: 'daily',
      };
    }
  }

  return null;
}

module.exports = {
  lookupPrice,
  TOLERANCE_MINUTES,
};