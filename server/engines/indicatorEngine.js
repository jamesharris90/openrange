const { queryWithTimeout } = require('../db/pg');

const indicatorCache = new Map();
const INDICATOR_CACHE_TTL_MS = 60 * 1000;
const MAX_DAILY_ROWS = 320;
const TECHNICAL_MIN_DAILY_ROWS = 200;
let ensureSchemaPromise = null;

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toUnixSeconds(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }

  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function roundNumber(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function toIsoDateFromUnixSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return new Date(numeric * 1000).toISOString().slice(0, 10);
}

async function ensureTechnicalIndicatorSchema() {
  if (ensureSchemaPromise) {
    return ensureSchemaPromise;
  }

  const statements = [
    `CREATE TABLE IF NOT EXISTS technical_indicators (
       symbol TEXT PRIMARY KEY,
       as_of_date DATE,
       close NUMERIC,
       ema9 NUMERIC,
       ema20 NUMERIC,
       ema50 NUMERIC,
       ema200 NUMERIC,
       rsi14 NUMERIC,
       macd NUMERIC,
       macd_signal NUMERIC,
       macd_histogram NUMERIC,
       source TEXT NOT NULL DEFAULT 'daily_ohlc',
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_technical_indicators_as_of_date
       ON technical_indicators (as_of_date DESC)`
  ];

  ensureSchemaPromise = (async () => {
    for (const statement of statements) {
      await queryWithTimeout(statement, [], {
        timeoutMs: 12000,
        label: 'indicator_engine.ensure_schema',
        maxRetries: 0,
        poolType: 'write',
      });
    }
  })();

  try {
    await ensureSchemaPromise;
  } catch (error) {
    ensureSchemaPromise = null;
    throw error;
  }
}

function emptyIndicators() {
  return {
    price: null,
    vwap: null,
    ema9: null,
    ema20: null,
    macd: {
      macd: null,
      signal: null,
      histogram: null,
      state: 'neutral',
    },
    structure: {
      above_vwap: null,
      ema_trend: 'neutral',
      macd_state: 'neutral',
    },
    panels: {
      '1min': [],
      '5min': [],
      '1day': [],
    },
    updated_at: null,
  };
}

function getCachedIndicators(symbol) {
  const hit = indicatorCache.get(symbol);
  if (!hit) return null;
  if ((Date.now() - hit.timestamp) >= INDICATOR_CACHE_TTL_MS) {
    indicatorCache.delete(symbol);
    return null;
  }
  return hit.value;
}

function setCachedIndicators(symbol, value) {
  indicatorCache.set(symbol, {
    value,
    timestamp: Date.now(),
  });
  return value;
}

async function readIntradayRows(symbol) {
  const result = await queryWithTimeout(
    `SELECT EXTRACT(EPOCH FROM "timestamp")::bigint AS time,
            open,
            high,
            low,
            close,
            volume
     FROM intraday_1m
     WHERE symbol = $1
     ORDER BY "timestamp" ASC`,
    [symbol],
    {
      timeoutMs: 12000,
      label: 'indicator_engine.intraday_rows',
      maxRetries: 0,
    }
  );

  return (result.rows || [])
    .map((row) => ({
      time: toUnixSeconds(row.time),
      open: toNumber(row.open),
      high: toNumber(row.high),
      low: toNumber(row.low),
      close: toNumber(row.close),
      volume: toNumber(row.volume) ?? 0,
    }))
    .filter((row) => row.time !== null && row.open !== null && row.high !== null && row.low !== null && row.close !== null)
    .sort((left, right) => left.time - right.time);
}

async function readDailyRows(symbol) {
  const result = await queryWithTimeout(
    `SELECT date::text AS date,
            open,
            high,
            low,
            close,
            volume
     FROM daily_ohlc
     WHERE symbol = $1
     ORDER BY date DESC
     LIMIT $2`,
    [symbol, MAX_DAILY_ROWS],
    {
      timeoutMs: 12000,
      label: 'indicator_engine.daily_rows',
      maxRetries: 0,
    }
  );

  return (result.rows || [])
    .map((row) => ({
      time: toUnixSeconds(`${row.date}T00:00:00Z`),
      open: toNumber(row.open),
      high: toNumber(row.high),
      low: toNumber(row.low),
      close: toNumber(row.close),
      volume: toNumber(row.volume) ?? 0,
    }))
    .filter((row) => row.time !== null && row.open !== null && row.high !== null && row.low !== null && row.close !== null)
    .sort((left, right) => left.time - right.time);
}

function latestSessionCandles(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return [];
  }

  const lastTime = candles[candles.length - 1]?.time;
  if (!Number.isFinite(lastTime)) {
    return [];
  }

  const sessionKey = new Date(lastTime * 1000).toISOString().slice(0, 10);
  return candles.filter((row) => new Date(row.time * 1000).toISOString().slice(0, 10) === sessionKey);
}

function aggregateCandles(candles, minutes) {
  if (!Array.isArray(candles) || candles.length === 0 || minutes <= 1) {
    return Array.isArray(candles) ? candles : [];
  }

  const bucketSeconds = minutes * 60;
  const buckets = new Map();

  for (const candle of candles) {
    const bucketTime = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
    const current = buckets.get(bucketTime);
    if (!current) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
      continue;
    }

    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
  }

  return Array.from(buckets.values()).sort((left, right) => left.time - right.time);
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const valid = values.map(Number).filter(Number.isFinite);
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function computeEmaSeries(candles, period) {
  if (!Array.isArray(candles) || candles.length < period) {
    return [];
  }

  const closes = candles.map((row) => row.close);
  const multiplier = 2 / (period + 1);
  let current = average(closes.slice(0, period));
  if (!Number.isFinite(current)) {
    return [];
  }

  const series = [{ time: candles[period - 1].time, value: roundNumber(current, 6) }];
  for (let index = period; index < candles.length; index += 1) {
    current = (closes[index] * multiplier) + (current * (1 - multiplier));
    series.push({ time: candles[index].time, value: roundNumber(current, 6) });
  }

  return series;
}

function computeSessionVwapSeries(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return [];
  }

  const series = [];
  let currentDay = null;
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    const dayKey = new Date(candle.time * 1000).toISOString().slice(0, 10);
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      cumulativePriceVolume = 0;
      cumulativeVolume = 0;
    }

    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const volume = Number.isFinite(candle.volume) ? candle.volume : 0;
    cumulativePriceVolume += typicalPrice * volume;
    cumulativeVolume += volume;

    series.push({
      time: candle.time,
      value: cumulativeVolume > 0 ? roundNumber(cumulativePriceVolume / cumulativeVolume, 6) : null,
    });
  }

  return series.filter((row) => row.value !== null);
}

function computeMacdSeries(candles) {
  if (!Array.isArray(candles) || candles.length < 35) {
    return {
      macd: [],
      signal: [],
      histogram: [],
      state: 'neutral',
    };
  }

  const ema12 = computeEmaSeries(candles, 12);
  const ema26Map = new Map(computeEmaSeries(candles, 26).map((row) => [row.time, row.value]));
  const macdLine = ema12
    .map((row) => {
      const slow = ema26Map.get(row.time);
      if (!Number.isFinite(row.value) || !Number.isFinite(slow)) return null;
      return {
        time: row.time,
        value: roundNumber(row.value - slow, 6),
      };
    })
    .filter(Boolean);

  if (macdLine.length < 9) {
    return {
      macd: macdLine,
      signal: [],
      histogram: [],
      state: 'neutral',
    };
  }

  const macdCandles = macdLine.map((row) => ({
    time: row.time,
    open: row.value,
    high: row.value,
    low: row.value,
    close: row.value,
    volume: 0,
  }));
  const signal = computeEmaSeries(macdCandles, 9);
  const signalMap = new Map(signal.map((row) => [row.time, row.value]));
  const histogram = macdLine
    .map((row) => {
      const signalValue = signalMap.get(row.time);
      if (!Number.isFinite(signalValue)) return null;
      return {
        time: row.time,
        value: roundNumber(row.value - signalValue, 6),
      };
    })
    .filter(Boolean);

  const latestMacd = macdLine[macdLine.length - 1]?.value;
  const latestSignal = signal[signal.length - 1]?.value;
  const latestHistogram = histogram[histogram.length - 1]?.value;
  const state = Number.isFinite(latestMacd) && Number.isFinite(latestSignal) && Number.isFinite(latestHistogram)
    ? latestMacd > latestSignal && latestHistogram > 0
      ? 'bullish_momentum'
      : latestMacd < latestSignal && latestHistogram < 0
        ? 'bearish_momentum'
        : 'neutral'
    : 'neutral';

  return {
    macd: macdLine,
    signal,
    histogram,
    state,
  };
}

function computeRsiSeries(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) {
    return [];
  }

  const deltas = [];
  for (let index = 1; index < candles.length; index += 1) {
    deltas.push(candles[index].close - candles[index - 1].close);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let index = 0; index < period; index += 1) {
    const delta = deltas[index];
    if (delta > 0) avgGain += delta;
    if (delta < 0) avgLoss += Math.abs(delta);
  }

  avgGain /= period;
  avgLoss /= period;

  const series = [];
  for (let index = period; index < deltas.length; index += 1) {
    const delta = deltas[index];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    const rs = avgLoss === 0 ? Number.POSITIVE_INFINITY : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    series.push({
      time: candles[index + 1].time,
      value: roundNumber(rsi, 6),
    });
  }

  return series;
}

function pointMap(series) {
  return new Map((Array.isArray(series) ? series : []).map((row) => [row.time, row.value]));
}

function buildPanelSeries(candles, options = {}) {
  const includeVwap = options.includeVwap !== false;
  const ema9 = computeEmaSeries(candles, 9);
  const ema20 = computeEmaSeries(candles, 20);
  const vwap = includeVwap ? computeSessionVwapSeries(candles) : [];
  const macd = computeMacdSeries(candles);

  const ema9Map = pointMap(ema9);
  const ema20Map = pointMap(ema20);
  const vwapMap = pointMap(vwap);
  const macdMap = pointMap(macd.macd);
  const signalMap = pointMap(macd.signal);
  const histogramMap = pointMap(macd.histogram);

  return candles.map((candle) => ({
    time: candle.time,
    close: roundNumber(candle.close, 6),
    volume: roundNumber(candle.volume, 6),
    vwap: includeVwap ? (vwapMap.get(candle.time) ?? null) : null,
    ema9: ema9Map.get(candle.time) ?? null,
    ema20: ema20Map.get(candle.time) ?? null,
    macd: macdMap.get(candle.time) ?? null,
    signal: signalMap.get(candle.time) ?? null,
    histogram: histogramMap.get(candle.time) ?? null,
  }));
}

function buildCurrentIndicators(oneMinuteSeries) {
  if (!Array.isArray(oneMinuteSeries) || oneMinuteSeries.length === 0) {
    return emptyIndicators();
  }

  const latest = oneMinuteSeries[oneMinuteSeries.length - 1];
  const macdState = latest.macd !== null && latest.signal !== null && latest.histogram !== null
    ? latest.macd > latest.signal && latest.histogram > 0
      ? 'bullish_momentum'
      : latest.macd < latest.signal && latest.histogram < 0
        ? 'bearish_momentum'
        : 'neutral'
    : 'neutral';
  const emaTrend = latest.ema9 !== null && latest.ema20 !== null
    ? latest.ema9 > latest.ema20
      ? 'bullish'
      : latest.ema9 < latest.ema20
        ? 'bearish'
        : 'neutral'
    : 'neutral';

  return {
    price: latest.close ?? null,
    vwap: latest.vwap ?? null,
    ema9: latest.ema9 ?? null,
    ema20: latest.ema20 ?? null,
    macd: {
      macd: latest.macd ?? null,
      signal: latest.signal ?? null,
      histogram: latest.histogram ?? null,
      state: macdState,
    },
    structure: {
      above_vwap: latest.close !== null && latest.vwap !== null ? latest.close > latest.vwap : null,
      ema_trend: emaTrend,
      macd_state: macdState,
    },
    panels: {
      '1min': [],
      '5min': [],
      '1day': [],
    },
    updated_at: latest.time ? new Date(latest.time * 1000).toISOString() : null,
  };
}

function buildLatestDailyIndicatorSnapshot(symbol, dailyRows) {
  if (!Array.isArray(dailyRows) || dailyRows.length < TECHNICAL_MIN_DAILY_ROWS) {
    return null;
  }

  const latest = dailyRows[dailyRows.length - 1] || null;
  if (!latest) {
    return null;
  }

  const ema9 = computeEmaSeries(dailyRows, 9);
  const ema20 = computeEmaSeries(dailyRows, 20);
  const ema50 = computeEmaSeries(dailyRows, 50);
  const ema200 = computeEmaSeries(dailyRows, 200);
  const macd = computeMacdSeries(dailyRows);
  const rsi14 = computeRsiSeries(dailyRows, 14);

  return {
    symbol,
    as_of_date: toIsoDateFromUnixSeconds(latest.time),
    close: roundNumber(latest.close, 6),
    ema9: ema9[ema9.length - 1]?.value ?? null,
    ema20: ema20[ema20.length - 1]?.value ?? null,
    ema50: ema50[ema50.length - 1]?.value ?? null,
    ema200: ema200[ema200.length - 1]?.value ?? null,
    rsi14: rsi14[rsi14.length - 1]?.value ?? null,
    macd: macd.macd[macd.macd.length - 1]?.value ?? null,
    macd_signal: macd.signal[macd.signal.length - 1]?.value ?? null,
    macd_histogram: macd.histogram[macd.histogram.length - 1]?.value ?? null,
  };
}

function computeDailySummary(dailyRows = [], intradayRows = []) {
  if (!Array.isArray(dailyRows) || dailyRows.length === 0) {
    return {
      sma20: null,
      sma50: null,
      sma200: null,
      adr_pct: null,
      high_52w: null,
      low_52w: null,
      latest_open: null,
      latest_close: null,
      session_high: null,
    };
  }

  const latest = dailyRows[dailyRows.length - 1] || null;
  const recent20 = dailyRows.slice(-20);
  const recent50 = dailyRows.slice(-50);
  const recent200 = dailyRows.slice(-200);
  const recent252 = dailyRows.slice(-252);
  const sessionRows = latestSessionCandles(intradayRows);
  const highs52w = recent252.map((row) => row.high).filter(Number.isFinite);
  const lows52w = recent252.map((row) => row.low).filter(Number.isFinite);
  const sessionHighs = sessionRows.map((row) => row.high).filter(Number.isFinite);
  const adrSeries = recent20
    .map((row) => (row.close ? ((row.high - row.low) / row.close) * 100 : null))
    .filter((value) => Number.isFinite(value));

  return {
    sma20: roundNumber(average(recent20.map((row) => row.close)), 6),
    sma50: roundNumber(average(recent50.map((row) => row.close)), 6),
    sma200: roundNumber(average(recent200.map((row) => row.close)), 6),
    adr_pct: roundNumber(average(adrSeries), 6),
    high_52w: highs52w.length > 0 ? roundNumber(Math.max(...highs52w), 6) : null,
    low_52w: lows52w.length > 0 ? roundNumber(Math.min(...lows52w), 6) : null,
    latest_open: latest?.open ?? null,
    latest_close: latest?.close ?? null,
    session_high: sessionHighs.length > 0
      ? roundNumber(Math.max(...sessionHighs), 6)
      : null,
  };
}

async function persistTechnicalIndicatorSnapshot(snapshot) {
  if (!snapshot?.symbol || !snapshot?.as_of_date) {
    return;
  }

  await queryWithTimeout(
    `INSERT INTO technical_indicators (
       symbol, as_of_date, close, ema9, ema20, ema50, ema200, rsi14, macd, macd_signal, macd_histogram, source, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'daily_ohlc', NOW()
     )
     ON CONFLICT (symbol) DO UPDATE SET
       as_of_date = EXCLUDED.as_of_date,
       close = EXCLUDED.close,
       ema9 = EXCLUDED.ema9,
       ema20 = EXCLUDED.ema20,
       ema50 = EXCLUDED.ema50,
       ema200 = EXCLUDED.ema200,
       rsi14 = EXCLUDED.rsi14,
       macd = EXCLUDED.macd,
       macd_signal = EXCLUDED.macd_signal,
       macd_histogram = EXCLUDED.macd_histogram,
       source = EXCLUDED.source,
       updated_at = NOW()`,
    [
      snapshot.symbol,
      snapshot.as_of_date,
      snapshot.close,
      snapshot.ema9,
      snapshot.ema20,
      snapshot.ema50,
      snapshot.ema200,
      snapshot.rsi14,
      snapshot.macd,
      snapshot.macd_signal,
      snapshot.macd_histogram,
    ],
    {
      timeoutMs: 12000,
      label: 'indicator_engine.persist_snapshot',
      maxRetries: 0,
      poolType: 'write',
    }
  );
}

async function backfillTechnicalIndicators(options = {}) {
  await ensureTechnicalIndicatorSchema();

  const limit = Number(options.limit);
  const batchSize = Math.max(1, Math.min(Number(options.batchSize) || 25, 100));
  const requestedSymbols = Array.isArray(options.symbols)
    ? Array.from(new Set(options.symbols.map(normalizeSymbol).filter(Boolean)))
    : [];
  const requestedSet = new Set(requestedSymbols);
  const result = await queryWithTimeout(
    `SELECT symbol
     FROM daily_ohlc
     GROUP BY symbol
     HAVING COUNT(*) >= $1
     ORDER BY symbol ASC
     ${Number.isFinite(limit) && limit > 0 ? 'LIMIT $2' : ''}`,
    Number.isFinite(limit) && limit > 0
      ? [TECHNICAL_MIN_DAILY_ROWS, limit]
      : [TECHNICAL_MIN_DAILY_ROWS],
    {
      timeoutMs: 20000,
      label: 'indicator_engine.backfill_symbols',
      maxRetries: 0,
    }
  );

  const symbols = (result.rows || [])
    .map((row) => normalizeSymbol(row.symbol))
    .filter((symbol) => Boolean(symbol) && (requestedSet.size === 0 || requestedSet.has(symbol)));
  let persisted = 0;

  for (let index = 0; index < symbols.length; index += batchSize) {
    const batch = symbols.slice(index, index + batchSize);
    const snapshots = await Promise.all(batch.map(async (symbol) => {
      const dailyRows = await readDailyRows(symbol);
      return buildLatestDailyIndicatorSnapshot(symbol, dailyRows);
    }));

    for (const snapshot of snapshots) {
      if (!snapshot) {
        continue;
      }

      await persistTechnicalIndicatorSnapshot(snapshot);
      persisted += 1;
    }
  }

  return {
    success: true,
    symbols_scanned: symbols.length,
    persisted,
    minimum_daily_rows: TECHNICAL_MIN_DAILY_ROWS,
  };
}

async function computeIndicators(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) {
    throw new Error('symbol_required');
  }

  await ensureTechnicalIndicatorSchema();

  const [intradayRows, dailyRows] = await Promise.all([
    readIntradayRows(symbol),
    readDailyRows(symbol),
  ]);

  if (dailyRows.length < TECHNICAL_MIN_DAILY_ROWS) {
    return emptyIndicators();
  }

  const sessionIntradayRows = latestSessionCandles(intradayRows);
  const oneMinutePanels = buildPanelSeries(sessionIntradayRows, { includeVwap: true });
  const fiveMinutePanels = buildPanelSeries(aggregateCandles(sessionIntradayRows, 5), { includeVwap: true });
  const oneDayPanels = buildPanelSeries(dailyRows.slice(-180), { includeVwap: false });
  const current = buildCurrentIndicators(oneMinutePanels);

  const snapshot = buildLatestDailyIndicatorSnapshot(symbol, dailyRows);
  if (snapshot) {
    await persistTechnicalIndicatorSnapshot(snapshot);
  }

  return {
    ...current,
    panels: {
      '1min': oneMinutePanels,
      '5min': fiveMinutePanels,
      '1day': oneDayPanels,
    },
  };
}

async function getIndicators(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) {
    return emptyIndicators();
  }

  const cached = getCachedIndicators(symbol);
  if (cached) {
    return cached;
  }

  const computed = await computeIndicators(symbol);
  return setCachedIndicators(symbol, computed);
}

async function getDailyTechnicalSummary(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) {
    return computeDailySummary();
  }

  const [dailyRows, intradayRows] = await Promise.all([
    readDailyRows(symbol),
    readIntradayRows(symbol),
  ]);

  return computeDailySummary(dailyRows, intradayRows);
}

module.exports = {
  aggregateCandles,
  backfillTechnicalIndicators,
  computeEmaSeries,
  computeDailySummary,
  computeSessionVwapSeries,
  computeMacdSeries,
  ensureTechnicalIndicatorSchema,
  emptyIndicators,
  getDailyTechnicalSummary,
  getIndicators,
};