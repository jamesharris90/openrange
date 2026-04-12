const axios = require('axios');
const { queryWithTimeout } = require('../../db/pg');
const { supabaseAdmin } = require('../../services/supabaseClient');
const { fmpFetch } = require('../../services/fmpClient');
const { computeCompletenessConfidence } = require('../../services/dataConfidenceService');
const { buildWhy } = require('../engines/whyEngine');
const { buildMacroContext } = require('../engines/macroEngine');
const { getCoverageStatusBySymbols } = require('./coverageEngine');
const { getCoverageStatusesBySymbols } = require('../../services/dataCoverageStatusService');

const earningsLookupCache = new Map();
const EARNINGS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EARNINGS_NONE_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_YAHOO_LOOKUPS_PER_REQUEST = 20;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const INTRADAY_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const SIGNAL_BUCKET_WINDOW = 8;
const UNIVERSE_PAGE_SIZE = 1000;
const SYMBOL_BATCH_SIZE = 250;
const INTRADAY_SYMBOL_BATCH_SIZE = 125;
const DAILY_SYMBOL_BATCH_SIZE = 100;
const DAILY_TECHNICAL_LOOKBACK_ROWS = 260;
const SCREENER_SKIP_NEWS_ENRICHMENT = /^(1|true|yes)$/i.test(String(process.env.SCREENER_SKIP_NEWS_ENRICHMENT || ''));
const SECTOR_OVERRIDES = {
  NFE: 'Energy',
};
const SPAC_INDUSTRIES = new Set(['SHELL COMPANIES', 'BLANK CHECKS']);
const SPAC_NAME_PATTERNS = [
  'ACQUISITION CORP',
  'ACQUISITION CO',
  'BLANK CHECK',
  'SPAC',
  'HOLDINGS CORP',
];
const SIGNAL_STATES = {
  FORMING: 'FORMING',
  CONFIRMED: 'CONFIRMED',
  EXTENDED: 'EXTENDED',
  DEAD: 'DEAD',
};
const yahooClient = axios.create({
  timeout: 1000,
  validateStatus: () => true,
});

const INSTRUMENT_TYPES = {
  STOCK: 'STOCK',
  ETF: 'ETF',
  ADR: 'ADR',
  REIT: 'REIT',
  FUND: 'FUND',
  OTHER: 'OTHER',
};

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveSector(symbol, ...candidates) {
  const normalizedSymbol = typeof symbol === 'string' ? symbol.trim().toUpperCase() : null;
  if (normalizedSymbol && SECTOR_OVERRIDES[normalizedSymbol]) {
    return SECTOR_OVERRIDES[normalizedSymbol];
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function getEasternTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return {
    weekday: parts.weekday || 'Mon',
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function isPremarketSession(referenceTime = new Date()) {
  const { weekday, hour, minute } = getEasternTimeParts(referenceTime);
  if (weekday === 'Sat' || weekday === 'Sun') {
    return false;
  }

  const minutes = (hour * 60) + minute;
  return minutes >= 240 && minutes < 570;
}

function containsSpacNamePattern(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) {
    return false;
  }

  return SPAC_NAME_PATTERNS.some((pattern) => text.includes(pattern));
}

function isSpacOrShell({ companyName, industry, changePercent, volume, hasNews, hasEarnings }) {
  const normalizedIndustry = String(industry || '').trim().toUpperCase();
  if (SPAC_INDUSTRIES.has(normalizedIndustry)) {
    return true;
  }

  if (containsSpacNamePattern(companyName)) {
    return true;
  }

  return Math.abs(toNumber(changePercent) ?? 0) >= 100
    && (toNumber(volume) ?? 0) < 10000
    && !hasNews
    && !hasEarnings;
}

function resolveGapPercent({ price, previousClose, gapPercent }) {
  const explicitGap = toNumber(gapPercent);
  if (explicitGap !== null) {
    return explicitGap;
  }

  const currentPrice = toNumber(price);
  const baseline = toNumber(previousClose);
  if (currentPrice === null || baseline === null || baseline <= 0) {
    return null;
  }

  return Number((((currentPrice - baseline) / baseline) * 100).toFixed(6));
}

function normalizeScreenerRow(row) {
  return {
    symbol: row.symbol || null,
    name: row.name || row.company_name || null,
    company_name: row.company_name || row.name || null,
    industry: row.industry || null,
    price: toNumber(row.price),
    change_percent: toNumber(row.change_percent),
    volume: toNumber(row.volume),
    rvol: toNumber(row.rvol),
    gap_percent: toNumber(row.gap_percent),
    gapPercent: toNumber(row.gapPercent ?? row.gap_percent),
    preMarketPrice: toNumber(row.preMarketPrice),
    preMarketChange: toNumber(row.preMarketChange),
    preMarketVolume: toNumber(row.preMarketVolume),
    pm_change: toNumber(row.pm_change),
    pm_volume: toNumber(row.pm_volume),
    latest_news_at: row.latest_news_at || null,
    news_source: row.news_source || 'none',
    earnings_date: row.earnings_date || null,
    earnings_source: row.earnings_source || 'none',
    catalyst_type: row.catalyst_type || 'NONE',
    catalyst_strength: toNumber(row.catalyst_strength) ?? 0,
    sector: row.sector || null,
    exchange: row.exchange || null,
    instrument_type: Object.values(INSTRUMENT_TYPES).includes(row.instrument_type) ? row.instrument_type : INSTRUMENT_TYPES.STOCK,
    updated_at: row.updated_at || null,
    why: row.why || 'Price moving without a clear external catalyst',
    driver_type: row.driver_type || 'TECHNICAL',
    confidence: toNumber(row.confidence) ?? 0.4,
    linked_symbols: Array.isArray(row.linked_symbols) ? row.linked_symbols.filter(Boolean) : [],
    volume_last_5m: toNumber(row.volume_last_5m),
    avg_5m_volume: toNumber(row.avg_5m_volume),
    rvol_acceleration: toNumber(row.rvol_acceleration),
    price_range_contraction: toNumber(row.price_range_contraction),
    trend: row.trend || 'NEUTRAL',
    vwap_position: row.vwap_position || 'BELOW',
    momentum: row.momentum || 'BEARISH',
    tqi: toNumber(row.tqi) ?? 0,
    tqi_label: row.tqi_label || 'D',
    final_score: toNumber(row.final_score) ?? 0,
    coverage_score: toNumber(row.coverage_score) ?? 0,
    data_confidence: toNumber(row.data_confidence) ?? 0,
    data_confidence_label: row.data_confidence_label || row.data_quality_label || 'LOW',
    data_quality_label: row.data_quality_label || row.data_confidence_label || 'LOW',
    freshness_score: toNumber(row.freshness_score) ?? 0,
    source_quality: toNumber(row.source_quality) ?? 0,
    has_news: row.has_news !== undefined ? Boolean(row.has_news) : false,
    has_earnings: row.has_earnings !== undefined ? Boolean(row.has_earnings) : false,
    has_technicals: row.has_technicals !== undefined ? Boolean(row.has_technicals) : false,
    tradeable: row.tradeable !== undefined ? Boolean(row.tradeable) : true,
    first_seen_timestamp: row.first_seen_timestamp || null,
    time_since_first_seen: toNumber(row.time_since_first_seen),
    state: row.state || SIGNAL_STATES.DEAD,
    early_signal: Boolean(row.early_signal),
  };
}

function passesScreenerQualityGate(row) {
  const price = toNumber(row?.price);
  const changePercent = toNumber(row?.change_percent);
  const volume = toNumber(row?.volume);
  const avgVolume30d = toNumber(row?.avg_volume_30d);

  if (price === null || price <= 0) {
    return false;
  }

  if (volume === null || volume <= 0) {
    return false;
  }

  if (avgVolume30d === null || avgVolume30d <= 0) {
    return false;
  }

  if (changePercent === null || Math.abs(changePercent) >= 100) {
    return false;
  }

  const previousClose = price / (1 + (changePercent / 100));
  if (!Number.isFinite(previousClose) || previousClose <= 0) {
    return false;
  }

  return true;
}

function deriveInstrumentType(profile = {}) {
  const companyName = String(profile.company_name || '').toLowerCase();
  const industry = String(profile.industry || '').toLowerCase();
  const sector = String(profile.sector || '').toLowerCase();
  const combined = `${companyName} ${industry} ${sector}`;

  if (/\b(reit|real estate investment trust)\b/.test(combined)) {
    return INSTRUMENT_TYPES.REIT;
  }

  if (/\b(etf|exchange traded fund|exchange-traded fund)\b/.test(combined)) {
    return INSTRUMENT_TYPES.ETF;
  }

  if (/\b(adr|ads|american depositary|depositary receipt)\b/.test(combined)) {
    return INSTRUMENT_TYPES.ADR;
  }

  if (/\b(closed-end fund|closed end fund|fund|trust|unit|income shares)\b/.test(combined)) {
    return INSTRUMENT_TYPES.FUND;
  }

  return INSTRUMENT_TYPES.STOCK;
}

function toIsoString(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function shouldSkipNewsEnrichment(options = {}) {
  if (options.skipNewsEnrichment === undefined) {
    return SCREENER_SKIP_NEWS_ENRICHMENT;
  }

  return Boolean(options.skipNewsEnrichment);
}

async function fetchAllMarketQuotes() {
  const rows = [];
  let offset = 0;

  while (true) {
    const result = await supabaseAdmin
      .from('market_quotes')
      .select('symbol, price, change_percent, volume, relative_volume, sector, updated_at, premarket_volume, previous_close')
      .gt('price', 0)
      .gt('volume', 0)
      .order('volume', { ascending: false })
      .range(offset, offset + UNIVERSE_PAGE_SIZE - 1);

    if (result.error) {
      throw new Error(result.error.message || 'Failed to load market quotes');
    }

    const batch = Array.isArray(result.data) ? result.data : [];
    if (batch.length === 0) {
      break;
    }

    rows.push(...batch);

    if (batch.length < UNIVERSE_PAGE_SIZE) {
      break;
    }

    offset += UNIVERSE_PAGE_SIZE;
  }

  return rows;
}

async function fetchBatchedSupabaseRows(symbols, batchSize, loadBatch) {
  const rows = [];

  for (const symbolBatch of chunkArray(symbols, batchSize)) {
    const batchRows = await loadBatch(symbolBatch);
    if (Array.isArray(batchRows) && batchRows.length > 0) {
      rows.push(...batchRows);
    }
  }

  return rows;
}

async function fetchDailyTechnicalRows(symbols) {
  const rows = [];

  for (const symbolBatch of chunkArray(symbols, DAILY_SYMBOL_BATCH_SIZE)) {
    const result = await queryWithTimeout(
      `WITH target_symbols AS (
         SELECT UNNEST($1::text[]) AS symbol
       )
       SELECT t.symbol,
              d.date::text AS date,
              d.close::numeric AS close
       FROM target_symbols t
       JOIN LATERAL (
         SELECT date, close
         FROM daily_ohlc
         WHERE symbol = t.symbol
         ORDER BY date DESC
         LIMIT $2
       ) d ON TRUE
       ORDER BY t.symbol ASC, d.date ASC`,
      [symbolBatch, DAILY_TECHNICAL_LOOKBACK_ROWS],
      {
        timeoutMs: 120000,
        label: 'screener.daily_technicals',
        maxRetries: 0,
        poolType: 'read',
      }
    );

    if (Array.isArray(result?.rows) && result.rows.length > 0) {
      rows.push(...result.rows);
    }
  }

  return rows;
}

function computeSma(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }

  return average(values.slice(-period));
}

function computeEmaSeriesFromValues(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  let current = average(values.slice(0, period));
  if (!Number.isFinite(current)) {
    return [];
  }

  const series = [current];
  for (let index = period; index < values.length; index += 1) {
    current = (values[index] * multiplier) + (current * (1 - multiplier));
    series.push(current);
  }

  return series;
}

function computeMacdHistogram(values) {
  if (!Array.isArray(values) || values.length < 35) {
    return null;
  }

  const ema12Series = computeEmaSeriesFromValues(values, 12);
  const ema26Series = computeEmaSeriesFromValues(values, 26);
  if (ema12Series.length === 0 || ema26Series.length === 0) {
    return null;
  }

  const macdValues = [];
  for (let index = 25; index < values.length; index += 1) {
    const fastValue = ema12Series[index - 11];
    const slowValue = ema26Series[index - 25];
    if (!Number.isFinite(fastValue) || !Number.isFinite(slowValue)) {
      continue;
    }
    macdValues.push(fastValue - slowValue);
  }

  const signalSeries = computeEmaSeriesFromValues(macdValues, 9);
  if (macdValues.length === 0 || signalSeries.length === 0) {
    return null;
  }

  const latestMacd = macdValues[macdValues.length - 1];
  const latestSignal = signalSeries[signalSeries.length - 1];
  if (!Number.isFinite(latestMacd) || !Number.isFinite(latestSignal)) {
    return null;
  }

  return latestMacd - latestSignal;
}

function buildDailyTechnicalsBySymbol(rows = []) {
  const closesBySymbol = new Map();

  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol);
    const close = toNumber(row.close);
    if (!symbol || close === null) {
      continue;
    }

    const existing = closesBySymbol.get(symbol) || [];
    existing.push(close);
    closesBySymbol.set(symbol, existing);
  }

  const technicalsBySymbol = new Map();
  for (const [symbol, closes] of closesBySymbol.entries()) {
    technicalsBySymbol.set(symbol, {
      sma20: computeSma(closes, 20),
      sma50: computeSma(closes, 50),
      sma200: computeSma(closes, 200),
      macd: {
        histogram: computeMacdHistogram(closes),
      },
    });
  }

  return technicalsBySymbol;
}

function resolveTrend(price, technicals) {
  const sma20 = toNumber(technicals?.sma20);
  const sma50 = toNumber(technicals?.sma50);
  const sma200 = toNumber(technicals?.sma200);
  const currentPrice = toNumber(price);

  if (
    currentPrice !== null
    && sma20 !== null
    && sma50 !== null
    && sma200 !== null
    && currentPrice > sma20
    && sma20 > sma50
    && sma50 > sma200
  ) {
    return 'BULLISH';
  }

  if (
    currentPrice !== null
    && sma20 !== null
    && sma50 !== null
    && sma200 !== null
    && currentPrice < sma20
    && sma20 < sma50
    && sma50 < sma200
  ) {
    return 'BEARISH';
  }

  return 'NEUTRAL';
}

function resolveVwapPosition(price, vwap) {
  const currentPrice = toNumber(price);
  const referenceVwap = toNumber(vwap);
  return currentPrice !== null && referenceVwap !== null && currentPrice > referenceVwap ? 'ABOVE' : 'BELOW';
}

function resolveMomentum(technicals) {
  return (toNumber(technicals?.macd?.histogram) ?? 0) > 0 ? 'BULLISH' : 'BEARISH';
}

function resolveCatalystStrength(row) {
  switch (row.catalyst_type) {
    case 'NEWS':
    case 'EARNINGS':
      return 3;
    case 'RECENT_NEWS':
      return 2;
    case 'TECHNICAL':
      return 1;
    default:
      return 0;
  }
}

function calculateTQI(row) {
  let score = 0;

  if ((row.rvol ?? 0) >= 5) score += 30;
  else if ((row.rvol ?? 0) >= 3) score += 25;
  else if ((row.rvol ?? 0) >= 2) score += 20;
  else if ((row.rvol ?? 0) >= 1.5) score += 10;

  if (row.trend === 'BULLISH' || row.trend === 'BEARISH') score += 20;
  else score += 5;

  if (
    (row.trend === 'BULLISH' && row.vwap_position === 'ABOVE')
    || (row.trend === 'BEARISH' && row.vwap_position === 'BELOW')
  ) score += 15;
  else score += 5;

  if (
    (row.trend === 'BULLISH' && row.momentum === 'BULLISH')
    || (row.trend === 'BEARISH' && row.momentum === 'BEARISH')
  ) score += 15;
  else score += 5;

  switch (row.catalyst_strength) {
    case 3:
      score += 20;
      break;
    case 2:
      score += 15;
      break;
    case 1:
      score += 8;
      break;
    default:
      score += 0;
  }

  return score;
}

function resolveTqiLabel(value) {
  if (value >= 80) return 'A';
  if (value >= 65) return 'B';
  if (value >= 50) return 'C';
  return 'D';
}

function bucketTimestamp(timestampMs) {
  return Math.floor(timestampMs / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
}

function getLatestSnapshotRowMap(previousRows = []) {
  const previousRowMap = new Map();

  for (const row of previousRows) {
    if (!row?.symbol) continue;
    previousRowMap.set(row.symbol, row);
  }

  return previousRowMap;
}

function buildIntradayMetricsBySymbol(rows = []) {
  const rowsBySymbol = new Map();

  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol);
    const timestampMs = Date.parse(String(row.timestamp || ''));
    if (!symbol || Number.isNaN(timestampMs)) {
      continue;
    }

    const currentRows = rowsBySymbol.get(symbol) || [];
    currentRows.push({
      timestampMs,
      open: toNumber(row.open),
      high: toNumber(row.high),
      low: toNumber(row.low),
      close: toNumber(row.close),
      volume: toNumber(row.volume) ?? 0,
      session: row.session || null,
    });
    rowsBySymbol.set(symbol, currentRows);
  }

  const metricsBySymbol = new Map();

  for (const [symbol, symbolRows] of rowsBySymbol.entries()) {
    const orderedRows = symbolRows.sort((left, right) => left.timestampMs - right.timestampMs);
    const latestTimestampMs = orderedRows[orderedRows.length - 1]?.timestampMs;
    if (!latestTimestampMs) {
      continue;
    }

    const recentRows = orderedRows.filter((row) => row.timestampMs >= latestTimestampMs - (SIGNAL_BUCKET_WINDOW * FIVE_MINUTES_MS));
    const bucketMap = new Map();

    for (const row of recentRows) {
      const bucketKey = bucketTimestamp(row.timestampMs);
      const existing = bucketMap.get(bucketKey);
      if (!existing) {
        bucketMap.set(bucketKey, {
          bucketKey,
          open: row.open,
          close: row.close,
          high: row.high,
          low: row.low,
          volume: row.volume,
        });
        continue;
      }

      existing.close = row.close ?? existing.close;
      existing.high = Math.max(existing.high ?? row.high ?? 0, row.high ?? existing.high ?? 0);
      existing.low = Math.min(existing.low ?? row.low ?? Number.POSITIVE_INFINITY, row.low ?? existing.low ?? Number.POSITIVE_INFINITY);
      existing.volume += row.volume;
    }

    const buckets = Array.from(bucketMap.values())
      .sort((left, right) => left.bucketKey - right.bucketKey)
      .slice(-SIGNAL_BUCKET_WINDOW);

    const latestBucket = buckets[buckets.length - 1] || null;
    const previousBuckets = buckets.slice(0, -1);
    const previousBucket = previousBuckets[previousBuckets.length - 1] || null;
    const volumeLast5m = latestBucket?.volume ?? null;
    const avg5mVolume = previousBuckets.length > 0
      ? average(previousBuckets.map((bucket) => bucket.volume ?? 0))
      : (volumeLast5m ?? 0);
    const rvolAcceleration = volumeLast5m !== null
      ? volumeLast5m / Math.max(previousBucket?.volume ?? avg5mVolume ?? 1, 1)
      : null;

    const latestClose = latestBucket?.close ?? orderedRows[orderedRows.length - 1]?.close ?? null;
    const latestRangePct = latestBucket && latestClose
      ? ((Math.max((latestBucket.high ?? latestClose), latestClose) - Math.min((latestBucket.low ?? latestClose), latestClose)) / Math.max(latestClose, 0.01)) * 100
      : 0;
    const averagePreviousRangePct = previousBuckets.length > 0
      ? average(previousBuckets.map((bucket) => {
        const close = bucket.close ?? latestClose ?? 0;
        if (!close) return 0;
        return ((Math.max(bucket.high ?? close, close) - Math.min(bucket.low ?? close, close)) / Math.max(close, 0.01)) * 100;
      }))
      : 0;
    const priceRangeContraction = averagePreviousRangePct > 0
      ? clamp(1 - (latestRangePct / averagePreviousRangePct), -1, 1)
      : 0;

    const premarketHighCandidates = orderedRows
      .filter((row) => row.session === 'premarket' && row.high !== null)
      .map((row) => row.high);
    const premarketHigh = premarketHighCandidates.length > 0 ? Math.max(...premarketHighCandidates) : null;

    const vwapNumerator = orderedRows.reduce((total, row) => {
      const close = row.close ?? row.open ?? 0;
      return total + (close * (row.volume ?? 0));
    }, 0);
    const vwapDenominator = orderedRows.reduce((total, row) => total + (row.volume ?? 0), 0);
    const vwap = vwapDenominator > 0 ? vwapNumerator / vwapDenominator : null;

    metricsBySymbol.set(symbol, {
      volume_last_5m: volumeLast5m,
      avg_5m_volume: avg5mVolume,
      rvol_acceleration: rvolAcceleration,
      price_range_contraction: priceRangeContraction,
      premarket_high: premarketHigh,
      vwap,
    });
  }

  return metricsBySymbol;
}

function resolveSignalLifecycle(row, intradayMetrics, previousRow, fallbackFirstSeenTimestamp, snapshotTimestamp) {
  const snapshotTimestampIso = toIsoString(snapshotTimestamp) || new Date().toISOString();
  const changePercent = Math.abs(toNumber(row.change_percent) ?? 0);
  const currentPrice = toNumber(row.price);
  const rvol = toNumber(row.rvol) ?? 0;
  const volumeLast5m = toNumber(intradayMetrics?.volume_last_5m);
  const avg5mVolume = toNumber(intradayMetrics?.avg_5m_volume);
  const rvolAcceleration = toNumber(intradayMetrics?.rvol_acceleration);
  const priceRangeContraction = toNumber(intradayMetrics?.price_range_contraction);
  const vwap = toNumber(intradayMetrics?.vwap);
  const premarketHigh = toNumber(intradayMetrics?.premarket_high);
  const previousState = previousRow?.state || null;
  const previousEarlySignal = Boolean(previousRow?.early_signal);

  const volumeSpikeIncreasing = volumeLast5m !== null
    && avg5mVolume !== null
    && volumeLast5m > avg5mVolume * 1.15
    && (rvolAcceleration ?? 0) >= 1.05;
  const keyLevelBreak = Boolean(
    (vwap !== null && currentPrice !== null && currentPrice > vwap * 1.002)
    || (premarketHigh !== null && currentPrice !== null && currentPrice > premarketHigh * 1.001)
  );
  const lateStageExpansion = changePercent > 12
    && ((rvolAcceleration ?? 1) < 0.9 || (volumeLast5m !== null && avg5mVolume !== null && volumeLast5m < avg5mVolume * 0.85));
  const momentumFaded = rvol < 1.5
    || (volumeLast5m !== null && avg5mVolume !== null && volumeLast5m < avg5mVolume * 0.7);

  let state = SIGNAL_STATES.DEAD;

  if (changePercent > 20 || lateStageExpansion) {
    state = SIGNAL_STATES.EXTENDED;
  } else if (rvol > 3 && volumeSpikeIncreasing && changePercent < 5) {
    state = SIGNAL_STATES.FORMING;
  } else if (rvol > 3 && keyLevelBreak && changePercent < 20) {
    state = SIGNAL_STATES.CONFIRMED;
  } else if (previousState === SIGNAL_STATES.CONFIRMED && !momentumFaded && changePercent < 20) {
    state = SIGNAL_STATES.CONFIRMED;
  } else if (previousState === SIGNAL_STATES.FORMING && !momentumFaded && changePercent < 8) {
    state = SIGNAL_STATES.FORMING;
  }

  const earlySignal = state === SIGNAL_STATES.FORMING || state === SIGNAL_STATES.CONFIRMED;
  const firstSeenTimestamp = earlySignal
    ? (previousEarlySignal && previousRow?.first_seen_timestamp
      ? previousRow.first_seen_timestamp
      : (toIsoString(fallbackFirstSeenTimestamp) || toIsoString(row.updated_at) || snapshotTimestampIso))
    : (previousRow?.first_seen_timestamp || toIsoString(fallbackFirstSeenTimestamp) || null);

  const firstSeenTimestampIso = toIsoString(firstSeenTimestamp);
  const timeSinceFirstSeen = firstSeenTimestampIso
    ? Math.max(0, Math.round((Date.parse(snapshotTimestampIso) - Date.parse(firstSeenTimestampIso)) / 1000))
    : null;

  return {
    volume_last_5m: volumeLast5m,
    avg_5m_volume: avg5mVolume,
    rvol_acceleration: rvolAcceleration,
    price_range_contraction: priceRangeContraction,
    first_seen_timestamp: firstSeenTimestampIso,
    time_since_first_seen: timeSinceFirstSeen,
    state,
    early_signal: earlySignal,
  };
}

function resolveCatalystType(row) {
  const now = Date.now();

  if (row.earnings_date) {
    const earningsTime = Date.parse(`${row.earnings_date}T00:00:00Z`);
    if (!Number.isNaN(earningsTime)) {
      const daysDiff = Math.abs(Math.round((earningsTime - now) / 86400000));
      if (daysDiff <= 5) {
        return 'EARNINGS';
      }
    }
  }

  const latestNewsTime = Date.parse(row.latest_news_at || '');
  if (!Number.isNaN(latestNewsTime)) {
    const ageMs = now - latestNewsTime;
    if (ageMs <= 72 * 60 * 60 * 1000) {
      return 'NEWS';
    }

    if (ageMs <= 7 * 24 * 60 * 60 * 1000) {
      return 'RECENT_NEWS';
    }
  }

  if ((row.rvol ?? 0) > 2 && Math.abs(row.change_percent ?? 0) > 5) {
    return 'TECHNICAL';
  }

  return 'NONE';
}

function normalizeSymbol(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

function resolveLatestTimestamp(currentValue, nextValue) {
  if (!nextValue) return currentValue || null;
  if (!currentValue) return nextValue;

  const currentTime = Date.parse(currentValue);
  const nextTime = Date.parse(nextValue);
  if (Number.isNaN(nextTime)) return currentValue;
  if (Number.isNaN(currentTime)) return nextValue;
  return nextTime > currentTime ? nextValue : currentValue;
}

function resolveEarliestDate(currentValue, nextValue) {
  if (!nextValue) return currentValue || null;
  if (!currentValue) return nextValue;
  return nextValue < currentValue ? nextValue : currentValue;
}

function resolveClosestDate(currentValue, nextValue) {
  if (!nextValue) return currentValue || null;
  if (!currentValue) return nextValue;

  const currentTime = Date.parse(`${currentValue}T00:00:00Z`);
  const nextTime = Date.parse(`${nextValue}T00:00:00Z`);
  if (Number.isNaN(currentTime)) return nextValue;
  if (Number.isNaN(nextTime)) return currentValue;

  const currentDiff = Math.abs(currentTime - Date.now());
  const nextDiff = Math.abs(nextTime - Date.now());
  return nextDiff < currentDiff ? nextValue : currentValue;
}

function dedupeBySymbol(rows) {
  const seen = new Set();
  const deduped = [];

  for (const row of rows) {
    if (!row?.symbol || seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    deduped.push(row);
  }

  return deduped;
}

function getCachedEarningsLookup(symbol) {
  const cached = earningsLookupCache.get(symbol);
  if (!cached) {
    return null;
  }

  if (cached.expiry <= Date.now()) {
    earningsLookupCache.delete(symbol);
    return null;
  }

  return cached.value;
}

function setCachedEarningsLookup(symbol, value) {
  const ttlMs = value.earnings_source === 'none' ? EARNINGS_NONE_CACHE_TTL_MS : EARNINGS_CACHE_TTL_MS;
  earningsLookupCache.set(symbol, {
    value,
    expiry: Date.now() + ttlMs,
  });
}

async function fetchFmpEarnings(symbol) {
  try {
    const today = new Date();
    const to = new Date(today);
    to.setUTCDate(to.getUTCDate() + 180);
    const payload = await fmpFetch('/earnings-calendar', {
      from: today.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
    const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
    const firstRow = rows.find((row) => normalizeSymbol(row?.symbol) === symbol && (row?.date || row?.earningsDate || row?.reportedDate));
    const earningsDate = firstRow?.date || firstRow?.earningsDate || firstRow?.reportedDate || null;

    if (earningsDate) {
      return {
        earnings_date: String(earningsDate).slice(0, 10),
        earnings_source: 'fmp',
      };
    }
  } catch (_error) {
  }

  return null;
}

function parseIsoDate(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const parsed = new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function inferCadenceDays(rows = []) {
  const dates = rows
    .map((row) => parseIsoDate(row.report_date))
    .filter(Boolean)
    .map((value) => value.getTime())
    .sort((left, right) => right - left);

  const gaps = [];
  for (let index = 0; index < dates.length - 1; index += 1) {
    const diffDays = Math.round((dates[index] - dates[index + 1]) / 86400000);
    if (diffDays >= 60 && diffDays <= 130) {
      gaps.push(diffDays);
    }
  }

  if (gaps.length === 0) {
    return 90;
  }

  gaps.sort((left, right) => left - right);
  return gaps[Math.floor(gaps.length / 2)] || 90;
}

function projectNextEarningsDate(rows = [], referenceDate = new Date()) {
  if (rows.length < 2) {
    return null;
  }

  const orderedRows = [...rows]
    .filter((row) => row.report_date)
    .sort((left, right) => String(right.report_date).localeCompare(String(left.report_date)));
  if (orderedRows.length < 2) {
    return null;
  }

  const cadenceDays = inferCadenceDays(orderedRows);
  let nextDate = parseIsoDate(orderedRows[0].report_date);
  const floorDate = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  if (!nextDate) {
    return null;
  }

  do {
    nextDate.setUTCDate(nextDate.getUTCDate() + cadenceDays);
  } while (nextDate < floorDate);

  return nextDate.toISOString().slice(0, 10);
}

async function fetchBulkFmpUpcomingEarnings(symbols) {
  const normalizedSymbols = Array.from(new Set((symbols || []).map((symbol) => normalizeSymbol(symbol)).filter(Boolean)));
  const earningsBySymbol = new Map();
  if (!normalizedSymbols.length) {
    return earningsBySymbol;
  }

  try {
    const today = new Date();
    const to = new Date(today);
    to.setUTCDate(to.getUTCDate() + 180);
    const payload = await fmpFetch('/earnings-calendar', {
      from: today.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
    const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
    const allowed = new Set(normalizedSymbols);

    for (const row of rows) {
      const symbol = normalizeSymbol(row?.symbol);
      const earningsDate = row?.date || row?.earningsDate || row?.reportedDate || null;
      if (!symbol || !allowed.has(symbol) || earningsBySymbol.has(symbol) || !earningsDate) {
        continue;
      }

      earningsBySymbol.set(symbol, {
        earnings_date: String(earningsDate).slice(0, 10),
        earnings_source: 'fmp',
      });
    }
  } catch (_error) {
  }

  return earningsBySymbol;
}

async function fetchProjectedEarningsBySymbol(symbols) {
  const projectedBySymbol = new Map();
  if (!symbols.length) {
    return projectedBySymbol;
  }

  const today = new Date().toISOString().slice(0, 10);
  const historyRows = await fetchBatchedSupabaseRows(symbols, SYMBOL_BATCH_SIZE, async (symbolBatch) => {
    const result = await supabaseAdmin
      .from('earnings_history')
      .select('symbol, report_date, report_time')
      .in('symbol', symbolBatch)
      .lt('report_date', today)
      .not('report_date', 'is', null)
      .order('report_date', { ascending: false });

    if (result.error) {
      throw new Error(result.error.message || 'Failed to load projected screener earnings history');
    }

    return result.data || [];
  });

  const historyBySymbol = new Map();
  for (const row of historyRows) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) {
      continue;
    }

    const currentRows = historyBySymbol.get(symbol) || [];
    if (currentRows.length >= 4) {
      continue;
    }

    currentRows.push({
      report_date: String(row.report_date).slice(0, 10),
      report_time: row.report_time || null,
    });
    historyBySymbol.set(symbol, currentRows);
  }

  for (const symbol of symbols) {
    const projectedDate = projectNextEarningsDate(historyBySymbol.get(symbol) || []);
    if (!projectedDate) {
      continue;
    }

    projectedBySymbol.set(symbol, {
      earnings_date: projectedDate,
      earnings_source: 'projected',
    });
  }

  return projectedBySymbol;
}

async function fetchDatabaseEarnings(symbol) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await supabaseAdmin
    .from('earnings_events')
    .select('report_date')
    .eq('symbol', symbol)
    .gte('report_date', today)
    .not('report_date', 'is', null)
    .order('report_date', { ascending: true })
    .limit(1);

  if (result.error) {
    throw new Error(result.error.message || 'Failed to load screener earnings_events');
  }

  const earningsDate = result.data?.[0]?.report_date || null;
  if (!earningsDate) {
    return null;
  }

  return {
    earnings_date: earningsDate,
    earnings_source: 'database',
  };
}

async function fetchYahooEarnings(symbol) {
  try {
    const response = await yahooClient.get(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
      {
        params: { modules: 'calendarEvents' },
      }
    );

    if (response.status < 200 || response.status >= 300) {
      return null;
    }

    const rawDate = response.data?.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate?.[0]?.raw;
    if (!rawDate) {
      return null;
    }

    const isoDate = new Date(Number(rawDate) * 1000).toISOString().slice(0, 10);
    return {
      earnings_date: isoDate,
      earnings_source: 'yahoo',
    };
  } catch (_error) {
    return null;
  }
}

async function fetchLatestNewsBySymbol(symbols) {
  const latestNewsBySymbol = new Map();
  const pageSize = 1000;

  if (!symbols.length) {
    return latestNewsBySymbol;
  }

  const newsPasses = [
    {
      sourceLabel: 'fmp',
      applySourceType: true,
    },
    {
      sourceLabel: 'database',
      applySourceType: false,
    },
  ];

  for (const pass of newsPasses) {
    for (const symbolBatch of chunkArray(symbols, SYMBOL_BATCH_SIZE)) {
      let offset = 0;

      while (latestNewsBySymbol.size < symbols.length) {
        let query = supabaseAdmin
          .from('news_articles')
          .select('symbol, headline, published_at, source_type')
          .in('symbol', symbolBatch)
          .not('published_at', 'is', null)
          .not('headline', 'is', null)
          .order('published_at', { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (pass.applySourceType) {
          query = query.eq('source_type', 'FMP');
        }

        const result = await query;
        if (result.error) {
          throw new Error(result.error.message || 'Failed to load screener news_articles');
        }

        const batch = Array.isArray(result.data) ? result.data : [];
        if (batch.length === 0) {
          break;
        }

        for (const row of batch) {
          const symbol = normalizeSymbol(row.symbol);
          const headline = typeof row.headline === 'string' ? row.headline.trim() : '';
          if (!symbol || latestNewsBySymbol.has(symbol) || !row.published_at || !headline) {
            continue;
          }

          latestNewsBySymbol.set(symbol, {
            latest_news_at: row.published_at,
            news_source: pass.sourceLabel,
          });
        }

        if (batch.length < pageSize) {
          break;
        }

        offset += pageSize;
      }
    }
  }

  return latestNewsBySymbol;
}

async function fetchRecentNewsContext(symbols) {
  const recentNewsBySymbol = new Map();
  const pageSize = 1000;

  if (!symbols.length) {
    return recentNewsBySymbol;
  }

  const cutoffIso = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  for (const symbolBatch of chunkArray(symbols, SYMBOL_BATCH_SIZE)) {
    let offset = 0;

    while (true) {
      const result = await supabaseAdmin
        .from('news_articles')
        .select('symbol, headline, published_at')
        .in('symbol', symbolBatch)
        .gte('published_at', cutoffIso)
        .not('published_at', 'is', null)
        .not('headline', 'is', null)
        .order('published_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (result.error) {
        throw new Error(result.error.message || 'Failed to load recent screener news context');
      }

      const batch = Array.isArray(result.data) ? result.data : [];
      if (batch.length === 0) {
        break;
      }

      for (const item of batch) {
        const symbol = normalizeSymbol(item.symbol);
        const headline = typeof item.headline === 'string' ? item.headline.trim() : '';
        if (!symbol || !headline || !item.published_at) {
          continue;
        }

        const currentItems = recentNewsBySymbol.get(symbol) || [];
        if (currentItems.length >= 3) {
          continue;
        }

        currentItems.push({
          headline,
          published_at: item.published_at,
        });
        recentNewsBySymbol.set(symbol, currentItems);
      }

      if (batch.length < pageSize) {
        break;
      }

      offset += pageSize;
    }
  }

  return recentNewsBySymbol;
}

async function fetchDbEarningsContext(symbols) {
  const earningsBySymbol = new Map();

  if (!symbols.length) {
    return earningsBySymbol;
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const symbolBatch of chunkArray(symbols, SYMBOL_BATCH_SIZE)) {
    const result = await supabaseAdmin
      .from('earnings_events')
      .select('symbol, report_date')
      .in('symbol', symbolBatch)
      .gte('report_date', today)
      .not('report_date', 'is', null)
      .order('report_date', { ascending: true });

    if (result.error) {
      throw new Error(result.error.message || 'Failed to load screener earnings context');
    }

    for (const item of result.data || []) {
      const symbol = normalizeSymbol(item.symbol);
      if (!symbol || !item.report_date) {
        continue;
      }

      earningsBySymbol.set(
        symbol,
        resolveClosestDate(earningsBySymbol.get(symbol) || null, item.report_date)
      );
    }
  }

  return earningsBySymbol;
}

async function fetchEarningsBySymbol(symbols) {
  const earningsBySymbol = new Map();
  let yahooLookups = 0;
  const today = new Date().toISOString().slice(0, 10);

  if (!symbols.length) {
    return earningsBySymbol;
  }

  for (const symbol of symbols) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) continue;

    const cached = getCachedEarningsLookup(normalized);
    if (cached) {
      earningsBySymbol.set(normalized, cached);
    }
  }

  const remainingSymbols = symbols
    .map((symbol) => normalizeSymbol(symbol))
    .filter((symbol) => symbol && !earningsBySymbol.has(symbol));

  const databaseRows = await fetchBatchedSupabaseRows(remainingSymbols, SYMBOL_BATCH_SIZE, async (symbolBatch) => {
    const result = await supabaseAdmin
      .from('earnings_events')
      .select('symbol, report_date')
      .in('symbol', symbolBatch)
      .gte('report_date', today)
      .not('report_date', 'is', null)
      .order('report_date', { ascending: true });

    if (result.error) {
      throw new Error(result.error.message || 'Failed to load screener earnings_events');
    }

    return result.data || [];
  });

  const databaseBySymbol = new Map();
  for (const row of databaseRows) {
    const symbol = normalizeSymbol(row.symbol);
    const reportDate = row.report_date || null;
    if (!symbol || !reportDate || databaseBySymbol.has(symbol)) {
      continue;
    }

    databaseBySymbol.set(symbol, {
      earnings_date: String(reportDate).slice(0, 10),
      earnings_source: 'database',
    });
  }

  const historyRows = await fetchBatchedSupabaseRows(
    remainingSymbols.filter((symbol) => !databaseBySymbol.has(symbol)),
    SYMBOL_BATCH_SIZE,
    async (symbolBatch) => {
      if (symbolBatch.length === 0) {
        return [];
      }

      const result = await supabaseAdmin
        .from('earnings_history')
        .select('symbol, report_date')
        .in('symbol', symbolBatch)
        .gte('report_date', today)
        .not('report_date', 'is', null)
        .order('report_date', { ascending: true });

      if (result.error) {
        throw new Error(result.error.message || 'Failed to load screener earnings_history');
      }

      return result.data || [];
    }
  );

  const historyBySymbol = new Map();
  for (const row of historyRows) {
    const symbol = normalizeSymbol(row.symbol);
    const reportDate = row.report_date || null;
    if (!symbol || !reportDate || historyBySymbol.has(symbol)) {
      continue;
    }

    historyBySymbol.set(symbol, {
      earnings_date: String(reportDate).slice(0, 10),
      earnings_source: 'database',
    });
  }

  const fmpBySymbol = await fetchBulkFmpUpcomingEarnings(
    remainingSymbols.filter((symbol) => !databaseBySymbol.has(symbol) && !historyBySymbol.has(symbol))
  );

  const projectedBySymbol = await fetchProjectedEarningsBySymbol(
    remainingSymbols.filter((symbol) => !databaseBySymbol.has(symbol) && !historyBySymbol.has(symbol) && !fmpBySymbol.has(symbol))
  );

  for (const rawSymbol of remainingSymbols) {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) {
      continue;
    }

    const databaseResult = databaseBySymbol.get(symbol) || null;
    if (databaseResult) {
      setCachedEarningsLookup(symbol, databaseResult);
      earningsBySymbol.set(symbol, databaseResult);
      continue;
    }

    const historyResult = historyBySymbol.get(symbol) || null;
    if (historyResult) {
      setCachedEarningsLookup(symbol, historyResult);
      earningsBySymbol.set(symbol, historyResult);
      continue;
    }

    const fmpResult = fmpBySymbol.get(symbol) || null;
    if (fmpResult) {
      setCachedEarningsLookup(symbol, fmpResult);
      earningsBySymbol.set(symbol, fmpResult);
      continue;
    }

    const projectedResult = projectedBySymbol.get(symbol) || null;
    if (projectedResult) {
      setCachedEarningsLookup(symbol, projectedResult);
      earningsBySymbol.set(symbol, projectedResult);
      continue;
    }

    if (yahooLookups < MAX_YAHOO_LOOKUPS_PER_REQUEST) {
      yahooLookups += 1;
      const yahooResult = await fetchYahooEarnings(symbol);
      if (yahooResult) {
        setCachedEarningsLookup(symbol, yahooResult);
        earningsBySymbol.set(symbol, yahooResult);
        continue;
      }
    }

    const noneResult = {
      earnings_date: null,
      earnings_source: 'none',
    };
    setCachedEarningsLookup(symbol, noneResult);
    earningsBySymbol.set(symbol, noneResult);
  }

  return earningsBySymbol;
}

async function fetchStableFallbackQuote() {
  if (!process.env.FMP_API_KEY) {
    return [];
  }

  const response = await axios.get('https://financialmodelingprep.com/stable/quote', {
    params: {
      symbol: 'AAPL',
      apikey: process.env.FMP_API_KEY,
    },
    timeout: 8000,
  });

  const rows = Array.isArray(response.data) ? response.data : [];
  if (rows.length === 0) {
    return [];
  }

  const quote = rows[0] || {};
  return [
    {
      symbol: quote.symbol || null,
      price: toNumber(quote.price),
      change_percent: toNumber(
        quote.changePercent ?? quote.change_percent ?? quote.changesPercentage ?? null
      ),
      volume: toNumber(quote.volume),
      rvol: null,
      gap_percent: null,
      latest_news_at: null,
      news_source: 'none',
      earnings_date: null,
      earnings_source: 'none',
      catalyst_type: 'TECHNICAL',
      sector: quote.sector || null,
      exchange: null,
      instrument_type: INSTRUMENT_TYPES.STOCK,
      updated_at: quote.updatedAt || quote.timestamp || null,
      why: 'Price moving without a clear external catalyst',
      driver_type: 'TECHNICAL',
      confidence: 0.4,
      linked_symbols: [],
      volume_last_5m: null,
      avg_5m_volume: null,
      rvol_acceleration: null,
      price_range_contraction: null,
      first_seen_timestamp: null,
      time_since_first_seen: null,
      state: SIGNAL_STATES.DEAD,
      early_signal: false,
    },
  ].filter((row) => row.symbol && row.price !== null && row.volume !== null);
}

async function getScreenerRows(options = {}) {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client unavailable');
  }

  const startedAt = Date.now();
  const skipNewsEnrichment = shouldSkipNewsEnrichment(options);

  const previousRowMap = getLatestSnapshotRowMap(options.previousRows);
  const snapshotTimestamp = options.snapshotTimestamp || new Date().toISOString();

  const rawQuoteUniverse = await fetchAllMarketQuotes();
  const quoteRows = dedupeBySymbol((rawQuoteUniverse || []).map((row) => ({
    symbol: row.symbol,
    price: row.price,
    change_percent: row.change_percent,
    volume: row.volume,
    relative_volume: row.relative_volume,
    sector: row.sector,
    updated_at: row.updated_at,
    premarket_volume: row.premarket_volume,
    previous_close: row.previous_close,
  })));

  console.log('[SCREENER_V2] Universe size:', quoteRows.length);

  if (quoteRows.length === 0) {
    const fallbackRows = await fetchStableFallbackQuote();
    return {
      rows: fallbackRows,
      fallbackUsed: fallbackRows.length > 0,
      meta: {
        raw_universe_size: 0,
        final_scored_size: fallbackRows.length,
        returned_rows: fallbackRows.length,
        total_ms: Date.now() - startedAt,
      },
      macroContext: await buildMacroContext({ topMovers: fallbackRows, recentNewsBySymbol: new Map() }).catch(() => ({
        regime: 'mixed',
        drivers: ['SPY 0.0% while QQQ 0.0% in a split tape'],
        dominant_sectors: ['technology'],
        weak_sectors: ['utilities'],
      })),
    };
  }

  const symbols = quoteRows.map((row) => row.symbol).filter(Boolean);

  const [metricsRows, sipRows, universeRows, profileRows, dailyTechnicalRows, coverageStatusBySymbol, coverageClassificationBySymbol] = await Promise.all([
    fetchBatchedSupabaseRows(symbols, SYMBOL_BATCH_SIZE, async (symbolBatch) => {
      const result = await supabaseAdmin
        .from('market_metrics')
        .select('symbol, price, change_percent, volume, gap_percent, relative_volume, avg_volume_30d, updated_at, last_updated, vwap, atr, rsi, previous_close')
        .in('symbol', symbolBatch);

      if (result.error) {
        throw new Error(result.error.message || 'Failed to load market metrics');
      }

      return result.data || [];
    }),
    fetchBatchedSupabaseRows(symbols, SYMBOL_BATCH_SIZE, async (symbolBatch) => {
      const result = await supabaseAdmin
        .from('stocks_in_play')
        .select('symbol, gap_percent, rvol, detected_at')
        .in('symbol', symbolBatch);

      if (result.error) {
        throw new Error(result.error.message || 'Failed to load stocks in play');
      }

      return result.data || [];
    }),
    fetchBatchedSupabaseRows(symbols, SYMBOL_BATCH_SIZE, async (symbolBatch) => {
      const result = await supabaseAdmin
        .from('ticker_universe')
        .select('symbol, company_name, sector, industry, exchange')
        .in('symbol', symbolBatch);

      if (result.error) {
        throw new Error(result.error.message || 'Failed to load ticker universe');
      }

      return result.data || [];
    }),
    fetchBatchedSupabaseRows(symbols, SYMBOL_BATCH_SIZE, async (symbolBatch) => {
      const result = await supabaseAdmin
        .from('company_profiles')
        .select('symbol, company_name, exchange, sector, industry')
        .in('symbol', symbolBatch);

      if (result.error) {
        throw new Error(result.error.message || 'Failed to load company profiles');
      }

      return result.data || [];
    }),
    fetchDailyTechnicalRows(symbols),
    getCoverageStatusBySymbols(symbols),
    getCoverageStatusesBySymbols(symbols),
  ]);

  const intradayCandidateSymbols = quoteRows
    .filter((row) => (row.relative_volume ?? 0) >= 1.5 || Math.abs(row.change_percent ?? 0) >= 3 || (row.volume ?? 0) >= 1_000_000)
    .map((row) => row.symbol)
    .filter(Boolean);
  const intradayRows = await fetchBatchedSupabaseRows(intradayCandidateSymbols, INTRADAY_SYMBOL_BATCH_SIZE, async (symbolBatch) => {
    const result = await supabaseAdmin
      .from('intraday_1m')
      .select('symbol, timestamp, open, high, low, close, volume, session')
      .in('symbol', symbolBatch)
      .gte('timestamp', new Date(Date.now() - INTRADAY_LOOKBACK_MS).toISOString())
      .order('timestamp', { ascending: true });

    if (result.error) {
      throw new Error(result.error.message || 'Failed to load intraday metrics');
    }

    return result.data || [];
  });

  const metricsBySymbol = new Map((metricsRows || []).map((row) => [row.symbol, row]));
  const sipBySymbol = new Map((sipRows || []).map((row) => [row.symbol, row]));
  const sectorBySymbol = new Map((universeRows || []).map((row) => [row.symbol, row]));
  const profileBySymbol = new Map((profileRows || []).map((row) => [row.symbol, row]));
  const intradayMetricsBySymbol = buildIntradayMetricsBySymbol(intradayRows || []);
  const dailyTechnicalsBySymbol = buildDailyTechnicalsBySymbol(dailyTechnicalRows || []);

  const coreRows = quoteRows
    .map((quote) => {
      const metrics = metricsBySymbol.get(quote.symbol) || {};
      const stocksInPlay = sipBySymbol.get(quote.symbol) || {};
      const universe = sectorBySymbol.get(quote.symbol) || {};
      const profile = profileBySymbol.get(quote.symbol) || {};
      const symbol = normalizeSymbol(quote.symbol);
      const intradayMetrics = intradayMetricsBySymbol.get(symbol) || {};
      const dailyTechnicals = dailyTechnicalsBySymbol.get(symbol) || {};
      const coverageStatus = coverageStatusBySymbol.get(symbol) || {};
      const coverageClassification = coverageClassificationBySymbol.get(symbol) || {};
      const price = quote.price ?? metrics.price ?? null;
      const vwap = metrics.vwap ?? intradayMetrics.vwap ?? null;
      const trend = resolveTrend(price, dailyTechnicals);
      const vwapPosition = resolveVwapPosition(price, vwap);
      const momentum = resolveMomentum(dailyTechnicals);
      const coverageScore = toNumber(coverageStatus.coverage_score) ?? 0;
      const avgVolume30d = toNumber(metrics.avg_volume_30d);
      const companyName = profile.company_name ?? universe.company_name ?? null;
      const industry = profile.industry ?? universe.industry ?? null;
      const exchange = profile.exchange ?? universe.exchange ?? null;
      const hasNews = Boolean(coverageStatus.has_news);
      const hasEarnings = Boolean(coverageStatus.has_earnings);
      const effectiveGapPercent = resolveGapPercent({
        price,
        previousClose: quote.previous_close ?? metrics.previous_close ?? null,
        gapPercent: stocksInPlay.gap_percent ?? metrics.gap_percent ?? null,
      });
      const premarketActive = isPremarketSession(new Date(snapshotTimestamp));
      const preMarketPrice = premarketActive ? price : null;
      const preMarketChange = premarketActive ? (quote.change_percent ?? metrics.change_percent ?? null) : null;
      const preMarketVolume = premarketActive
        ? (quote.premarket_volume ?? quote.volume ?? metrics.volume ?? null)
        : null;

      if (String(coverageClassification.status || '').toUpperCase() !== 'HAS_DATA') {
        return null;
      }

      if (!passesScreenerQualityGate({
        price,
        change_percent: quote.change_percent ?? metrics.change_percent ?? null,
        volume: quote.volume ?? metrics.volume ?? null,
        avg_volume_30d: avgVolume30d,
      })) {
        return null;
      }

      if (isSpacOrShell({
        companyName,
        industry,
        changePercent: quote.change_percent ?? metrics.change_percent ?? null,
        volume: quote.volume ?? metrics.volume ?? null,
        hasNews,
        hasEarnings,
      })) {
        return null;
      }

      return normalizeScreenerRow({
        symbol,
        name: companyName,
        company_name: companyName,
        industry,
        price,
        change_percent: quote.change_percent ?? metrics.change_percent ?? null,
        volume: quote.volume ?? metrics.volume ?? null,
        rvol: quote.relative_volume ?? stocksInPlay.rvol ?? metrics.relative_volume ?? null,
        gap_percent: effectiveGapPercent,
        gapPercent: effectiveGapPercent,
        preMarketPrice,
        preMarketChange,
        preMarketVolume,
        pm_change: preMarketChange,
        pm_volume: preMarketVolume,
        latest_news_at: null,
        news_source: 'none',
        earnings_date: null,
        earnings_source: 'none',
        sector: resolveSector(symbol, quote.sector, universe.sector, profile.sector),
        exchange,
        instrument_type: deriveInstrumentType({ ...universe, ...profile }),
        updated_at: quote.updated_at ?? metrics.updated_at ?? metrics.last_updated ?? stocksInPlay.detected_at ?? null,
        trend,
        vwap_position: vwapPosition,
        momentum,
        coverage_score: coverageScore,
        has_news: hasNews,
        has_earnings: hasEarnings,
        has_technicals: Boolean(coverageStatus.has_technicals),
        tradeable: coverageScore >= 60,
      });
    })
    .filter(Boolean)
    .filter((row) => row.symbol && row.price !== null && row.price > 0 && row.volume !== null && row.volume > 0)
    .sort((left, right) => {
      const rightRvol = right.rvol ?? -1;
      const leftRvol = left.rvol ?? -1;
      if (rightRvol !== leftRvol) return rightRvol - leftRvol;
      const rightAbsChange = Math.abs(right.change_percent ?? 0);
      const leftAbsChange = Math.abs(left.change_percent ?? 0);
      if (rightAbsChange !== leftAbsChange) return rightAbsChange - leftAbsChange;
      if ((right.volume ?? 0) !== (left.volume ?? 0)) return (right.volume ?? 0) - (left.volume ?? 0);
      return String(left.symbol).localeCompare(String(right.symbol));
    });

  const coreSymbols = coreRows.map((row) => row.symbol).filter(Boolean);
  const [latestNewsBySymbol, recentNewsBySymbol, earningsBySymbol, dbEarningsBySymbol] = skipNewsEnrichment
    ? [new Map(), new Map(), ...await Promise.all([
      fetchEarningsBySymbol(coreSymbols),
      fetchDbEarningsContext(coreSymbols),
    ])]
    : await Promise.all([
      fetchLatestNewsBySymbol(coreSymbols),
      fetchRecentNewsContext(coreSymbols),
      fetchEarningsBySymbol(coreSymbols),
      fetchDbEarningsContext(coreSymbols),
    ]);

  const enrichedRows = coreRows.map((row) => {
    if (!row.symbol) {
      return row;
    }

    const enrichedRow = {
      ...row,
      latest_news_at: latestNewsBySymbol.get(row.symbol)?.latest_news_at || null,
      news_source: latestNewsBySymbol.get(row.symbol)?.news_source || 'none',
      earnings_date: earningsBySymbol.get(row.symbol)?.earnings_date || null,
      earnings_source: earningsBySymbol.get(row.symbol)?.earnings_source || 'none',
      catalyst_type: resolveCatalystType({
        ...row,
        latest_news_at: latestNewsBySymbol.get(row.symbol)?.latest_news_at || null,
        earnings_date: earningsBySymbol.get(row.symbol)?.earnings_date || null,
      }),
    };

    return {
      ...enrichedRow,
      catalyst_strength: resolveCatalystStrength(enrichedRow),
    };
  });

  const macroContext = await buildMacroContext({
    topMovers: enrichedRows,
    recentNewsBySymbol,
  }).catch(() => ({
    regime: 'mixed',
    drivers: ['SPY 0.0% while QQQ 0.0% in a split tape'],
    dominant_sectors: ['technology'],
    weak_sectors: ['utilities'],
  }));

  const scoredRows = await Promise.all(enrichedRows.map(async (row) => {
    if (!row.symbol) {
      return row;
    }

    const why = await buildWhy(row.symbol, row, {
      recentNewsBySymbol,
      dbEarningsBySymbol,
      rows: enrichedRows,
      macroContext,
    });

    const lifecycle = resolveSignalLifecycle(
      row,
      intradayMetricsBySymbol.get(row.symbol) || null,
      previousRowMap.get(row.symbol) || null,
      sipBySymbol.get(row.symbol)?.detected_at || null,
      snapshotTimestamp,
    );

    const nextRow = {
      ...row,
      why: why.why,
      driver_type: why.driver_type,
      confidence: why.confidence,
      linked_symbols: why.linked_symbols || [],
      ...lifecycle,
    };

    const tqi = calculateTQI(nextRow);
    const metrics = metricsBySymbol.get(nextRow.symbol) || {};
    const hasChartData = intradayMetricsBySymbol.has(nextRow.symbol) || dailyTechnicalsBySymbol.has(nextRow.symbol);
    const hasTechnicals = [metrics.rsi, metrics.atr, metrics.vwap].every((value) => toNumber(value) !== null);
    const confidencePayload = computeCompletenessConfidence({
      has_price: toNumber(nextRow.price) !== null,
      has_volume: toNumber(nextRow.volume) !== null,
      has_chart_data: hasChartData,
      has_technicals: hasTechnicals,
      has_earnings: Boolean(nextRow.earnings_date),
    });
    const finalScore = Number((tqi * (confidencePayload.data_confidence / 100)).toFixed(2));

    return {
      ...nextRow,
      ...confidencePayload,
      has_chart_data: hasChartData,
      has_technicals: hasTechnicals,
      tradeable: (toNumber(nextRow.coverage_score) ?? 0) >= 60,
      tqi,
      tqi_label: resolveTqiLabel(tqi),
      final_score: finalScore,
    };
  }));

  const rows = [...scoredRows].sort((left, right) => {
    const rightVolume = right.volume ?? -1;
    const leftVolume = left.volume ?? -1;
    if (rightVolume !== leftVolume) return rightVolume - leftVolume;

    const rightAbsChange = Math.abs(right.change_percent ?? 0);
    const leftAbsChange = Math.abs(left.change_percent ?? 0);
    if (rightAbsChange !== leftAbsChange) return rightAbsChange - leftAbsChange;

    const rightRvol = right.rvol ?? -1;
    const leftRvol = left.rvol ?? -1;
    if (rightRvol !== leftRvol) return rightRvol - leftRvol;

    return String(left.symbol || '').localeCompare(String(right.symbol || ''));
  });

  const newsSourceCounts = rows.reduce((accumulator, row) => {
    accumulator[row.news_source] = (accumulator[row.news_source] || 0) + 1;
    return accumulator;
  }, {});
  const earningsSourceCounts = rows.reduce((accumulator, row) => {
    accumulator[row.earnings_source] = (accumulator[row.earnings_source] || 0) + 1;
    return accumulator;
  }, {});
  const driverTypeCounts = rows.reduce((accumulator, row) => {
    accumulator[row.driver_type] = (accumulator[row.driver_type] || 0) + 1;
    return accumulator;
  }, {});

  console.log('[SCREENER_V2] fallback sources', {
    raw_universe_size: quoteRows.length,
    final_scored_size: rows.length,
    news_enrichment_skipped: skipNewsEnrichment,
    news: newsSourceCounts,
    earnings: earningsSourceCounts,
    earnings_sources_summary: earningsSourceCounts,
    driver_types: driverTypeCounts,
  });

  if ((newsSourceCounts.none || 0) > 20) {
    console.warn('[SCREENER_V2] news none rows exceed threshold', {
      none: newsSourceCounts.none,
      news_sources_summary: newsSourceCounts,
    });
  }

  if (rows.length > 0) {
    return {
      rows,
      fallbackUsed: false,
      meta: {
        raw_universe_size: quoteRows.length,
        final_scored_size: rows.length,
        returned_rows: rows.length,
        news_enrichment_skipped: skipNewsEnrichment,
        total_ms: Date.now() - startedAt,
      },
      macroContext,
    };
  }

  const fallbackRows = await fetchStableFallbackQuote();
  return {
    rows: fallbackRows,
    fallbackUsed: fallbackRows.length > 0,
    meta: {
      raw_universe_size: quoteRows.length,
      final_scored_size: fallbackRows.length,
      returned_rows: fallbackRows.length,
      news_enrichment_skipped: skipNewsEnrichment,
      total_ms: Date.now() - startedAt,
    },
    macroContext: await buildMacroContext({ topMovers: fallbackRows, recentNewsBySymbol: new Map() }).catch(() => ({
      regime: 'mixed',
      drivers: ['SPY 0.0% while QQQ 0.0% in a split tape'],
      dominant_sectors: ['technology'],
      weak_sectors: ['utilities'],
    })),
  };
}

module.exports = {
  getScreenerRows,
};