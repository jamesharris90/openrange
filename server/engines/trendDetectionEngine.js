const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function findSwingPoints(candles) {
  const highs = [];
  const lows = [];

  for (let index = 1; index < candles.length - 1; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    const next = candles[index + 1];

    if (current.high > previous.high && current.high > next.high) {
      highs.push({ time: current.time, price: current.high });
    }

    if (current.low < previous.low && current.low < next.low) {
      lows.push({ time: current.time, price: current.low });
    }
  }

  return { highs, lows };
}

function inferTrend(highs, lows) {
  if (highs.length < 2 || lows.length < 2) return 'sideways';

  const lastHigh = highs[highs.length - 1].price;
  const priorHigh = highs[highs.length - 2].price;
  const lastLow = lows[lows.length - 1].price;
  const priorLow = lows[lows.length - 2].price;

  if (lastHigh > priorHigh && lastLow > priorLow) return 'uptrend';
  if (lastHigh < priorHigh && lastLow < priorLow) return 'downtrend';
  return 'sideways';
}

function buildChannel(candles) {
  if (candles.length < 10) return [];

  const window = candles.slice(-20);
  const first = window[0];
  const last = window[window.length - 1];
  const averagePrice = window.reduce((sum, row) => sum + toNumber(row.close), 0) / window.length;
  const dispersion = Math.max(
    0.25,
    Math.sqrt(window.reduce((sum, row) => {
      const delta = toNumber(row.close) - averagePrice;
      return sum + (delta * delta);
    }, 0) / window.length)
  );

  return [
    {
      line: 'upper',
      from: { time: first.time, price: toNumber(first.close) + dispersion },
      to: { time: last.time, price: toNumber(last.close) + dispersion },
    },
    {
      line: 'lower',
      from: { time: first.time, price: toNumber(first.close) - dispersion },
      to: { time: last.time, price: toNumber(last.close) - dispersion },
    },
  ];
}

function buildBreakouts(candles, highs, lows) {
  if (!candles.length || !highs.length || !lows.length) return [];

  const latest = candles[candles.length - 1];
  const maxHigh = Math.max(...highs.map((item) => toNumber(item.price)));
  const minLow = Math.min(...lows.map((item) => toNumber(item.price)));

  const breakouts = [];
  if (toNumber(latest.close) > maxHigh) {
    breakouts.push({ type: 'breakout_up', time: latest.time, price: latest.close, level: maxHigh });
  }
  if (toNumber(latest.close) < minLow) {
    breakouts.push({ type: 'breakout_down', time: latest.time, price: latest.close, level: minLow });
  }
  return breakouts;
}

async function ensureTrendTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS chart_trends (
      symbol TEXT PRIMARY KEY,
      trend TEXT,
      support JSONB,
      resistance JSONB,
      channel JSONB,
      breakouts JSONB,
      computed_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 5000, label: 'engines.trend.ensure_table', maxRetries: 0 }
  );
}

async function loadCandles(symbol) {
  const { rows } = await queryWithTimeout(
    `SELECT date::text AS time,
            open,
            high,
            low,
            close,
            volume
     FROM daily_ohlc
     WHERE symbol = $1
     ORDER BY date DESC
     LIMIT 120`,
    [symbol],
    { timeoutMs: 5000, label: 'engines.trend.load_candles', maxRetries: 0 }
  );

  return rows.reverse();
}

async function detectTrendForSymbol(symbol) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!normalizedSymbol) return null;

  const candles = await loadCandles(normalizedSymbol);
  if (candles.length < 10) return null;

  const { highs, lows } = findSwingPoints(candles);
  const trend = inferTrend(highs, lows);
  const support = lows.slice(-3).map((item) => toNumber(item.price));
  const resistance = highs.slice(-3).map((item) => toNumber(item.price));
  const channel = buildChannel(candles);
  const breakouts = buildBreakouts(candles, highs, lows);

  const payload = {
    trend,
    support,
    resistance,
    channel,
    breakouts,
  };

  await queryWithTimeout(
    `INSERT INTO chart_trends (
      symbol,
      trend,
      support,
      resistance,
      channel,
      breakouts,
      computed_at,
      updated_at
    ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, now(), now())
    ON CONFLICT (symbol)
    DO UPDATE SET
      trend = EXCLUDED.trend,
      support = EXCLUDED.support,
      resistance = EXCLUDED.resistance,
      channel = EXCLUDED.channel,
      breakouts = EXCLUDED.breakouts,
      computed_at = now(),
      updated_at = now()`,
    [
      normalizedSymbol,
      trend,
      JSON.stringify(support),
      JSON.stringify(resistance),
      JSON.stringify(channel),
      JSON.stringify(breakouts),
    ],
    { timeoutMs: 5000, label: 'engines.trend.upsert', maxRetries: 0 }
  );

  return {
    symbol: normalizedSymbol,
    ...payload,
  };
}

async function runTrendDetectionEngine() {
  const startedAt = Date.now();
  await ensureTrendTable();

  const { rows } = await queryWithTimeout(
    `SELECT symbol
     FROM tradable_universe
     ORDER BY COALESCE(relative_volume, 0) DESC, symbol ASC
     LIMIT 300`,
    [],
    { timeoutMs: 5000, label: 'engines.trend.symbols', maxRetries: 0 }
  );

  let processed = 0;
  for (const row of rows) {
    const result = await detectTrendForSymbol(row.symbol);
    if (result) processed += 1;
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('Trend detection engine complete', {
    scanned: rows.length,
    processed,
    runtimeMs,
  });

  return {
    scanned: rows.length,
    processed,
    runtimeMs,
  };
}

module.exports = {
  runTrendDetectionEngine,
  detectTrendForSymbol,
  ensureTrendTable,
};
