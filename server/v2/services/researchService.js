const axios = require('axios');

const { queryWithTimeout } = require('../../db/pg');
const {
  computeCompletenessConfidence,
  hasChartCandles,
  hasCompleteTechnicals,
} = require('../../services/dataConfidenceService');

const FMP_API_KEY = process.env.FMP_API_KEY || '';
const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_TIMEOUT_MS = 450;
const EARNINGS_CACHE_WINDOW_DAYS = 90;
const EARNINGS_STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const COMPANY_PROFILE_TIMEOUT_MS = 650;

let ensureEarningsSchemaPromise = null;
const earningsRefreshInFlight = new Map();

const REQUIRED_TABLES = [
  'market_metrics',
  'market_quotes',
  'intraday_1m',
  'daily_ohlc',
  'news_articles',
  'earnings_events',
  'earnings_history',
  'company_profiles',
];

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function getDefaultMCP(symbol) {
  return {
    summary: 'No edge - avoid until conditions improve',
    why: 'No clear catalyst, move appears technically driven and indicates low conviction.',
    what: 'Range-bound between 0.00 and 0.00',
    where: 'Watch breakout above 0.00 or breakdown below 0.00',
    when: 'Avoid until catalyst emerges',
    confidence: 20,
    confidence_reason: 'Limited due to lack of catalyst and weak structure.',
    trade_quality: 'LOW',
    improve: 'Needs confirmed catalyst and break above resistance required.',
    action: 'AVOID',
    trade_score: 10,
    expected_move: {
      value: null,
      percent: null,
      label: 'LOW',
    },
    risk: {
      entry: null,
      invalidation: null,
      reward: null,
      rr: null,
    },
  };
}

function emptyResearchData(symbol) {
  return {
    symbol,
    market: {},
    technicals: {},
    chart: {
      intraday: [],
      daily: [],
    },
    news: [],
    earnings: {
      latest: null,
      next: null,
    },
    company: {},
    mcp: getDefaultMCP(symbol),
    data_confidence: 0,
    data_confidence_label: 'LOW',
    data_quality_label: 'LOW',
    warnings: [],
  };
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;

}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeReportTime(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  if (/^(tbd|n\/a|na|unknown|--|none)$/i.test(text)) {
    return null;
  }

  return text;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

async function safeQuery(existingTables, tableName, sql, params, options, warnings, fallbackRows = []) {
  if (!existingTables.has(tableName)) {
    warnings.push(`Missing table: ${tableName}`);
    return fallbackRows;
  }

  try {
    const result = await queryWithTimeout(sql, params, {
      maxRetries: 0,
      ...options,
    });
    return result.rows || fallbackRows;
  } catch (error) {
    warnings.push(`${tableName}: ${error.message}`);
    return fallbackRows;
  }
}

function pickFirstNumber(source, keys) {
  for (const key of keys) {
    const value = toNullableNumber(source?.[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function normalizeMarketRow(row) {
  const quote = asObject(row?.quote);
  const metrics = asObject(row?.metrics);

  return {
    price: pickFirstNumber(quote, ['price']) ?? pickFirstNumber(metrics, ['price']),
    volume: pickFirstNumber(quote, ['volume']) ?? pickFirstNumber(metrics, ['volume']),
    market_cap: pickFirstNumber(quote, ['market_cap']),
    relative_volume: pickFirstNumber(metrics, ['relative_volume', 'rvol']),
  };
}

function normalizeTechnicalsRow(row) {
  const metrics = asObject(row?.metrics);

  return {
    atr: pickFirstNumber(metrics, ['atr']),
    rsi: pickFirstNumber(metrics, ['rsi']),
    vwap: pickFirstNumber(metrics, ['vwap']),
    relative_volume: pickFirstNumber(metrics, ['relative_volume', 'rvol']),
    avg_volume_30d: pickFirstNumber(metrics, ['avg_volume_30d', 'avg_30_day_volume']),
    sma_20: pickFirstNumber(metrics, ['sma_20', 'ma_20', 'ema_20']),
    sma_50: pickFirstNumber(metrics, ['sma_50', 'ma_50', 'ema_50']),
  };
}

function normalizeCandleRows(rows) {
  return toArray(rows)
    .map((row) => ({
      time: toNullableNumber(row.time),
      open: toNullableNumber(row.open),
      high: toNullableNumber(row.high),
      low: toNullableNumber(row.low),
      close: toNullableNumber(row.close),
      volume: toNullableNumber(row.volume) ?? 0,
    }))
    .filter((row) => row.time !== null && row.close !== null)
    .sort((left, right) => left.time - right.time);
}

function normalizeNewsRows(rows) {
  return toArray(rows)
    .map((row) => {
      const data = asObject(row?.data);
      const title = toNullableString(data.title) || toNullableString(data.headline);
      const symbols = toArray(data.symbols).map((value) => normalizeSymbol(value)).filter(Boolean);

      return {
        id: toNullableString(data.id) || toNullableString(data.uuid) || toNullableString(data.url),
        title,
        summary: toNullableString(data.summary) || toNullableString(data.description),
        source: toNullableString(data.source) || toNullableString(data.publisher),
        url: toNullableString(data.url),
        published_at: data.published_at || data.published || null,
        sentiment: toNullableString(data.sentiment),
        symbols,
        symbol: symbols[0] || null,
      };
    })
    .filter((item) => item.title || item.summary || item.url);
}

function normalizeEarningsRecord(data) {
  const record = asObject(data);
  if (Object.keys(record).length === 0) {
    return null;
  }

  return {
    symbol: normalizeSymbol(record.symbol),
    report_date: record.report_date || record.earnings_date || null,
    report_time: normalizeReportTime(record.report_time) || normalizeReportTime(record.time),
    eps_estimate: toNullableNumber(record.eps_estimate),
    eps_actual: toNullableNumber(record.eps_actual),
    revenue_estimate: toNullableNumber(record.revenue_estimate ?? record.rev_estimate),
    revenue_actual: toNullableNumber(record.revenue_actual ?? record.rev_actual),
    market_cap: toNullableNumber(record.market_cap),
    sector: toNullableString(record.sector),
    industry: toNullableString(record.industry),
  };
}

function normalizeFmpEarningsRows(rows, symbol) {
  return toArray(rows)
    .map((row) => asObject(row))
    .filter((row) => normalizeSymbol(row.symbol || symbol) === symbol)
    .map((row) => ({
      symbol,
      report_date: toNullableString(row.date || row.reportDate || row.fiscalDateEnding || row.report_date),
      report_time: normalizeReportTime(row.time || row.reportTime),
      eps_estimate: toNullableNumber(row.epsEstimated ?? row.epsEstimate ?? row.estimatedEps),
      eps_actual: toNullableNumber(row.eps ?? row.epsActual ?? row.actualEps),
      revenue_estimate: toNullableNumber(row.revenueEstimated ?? row.revenueEstimate ?? row.estimatedRevenue),
      revenue_actual: toNullableNumber(row.revenue ?? row.revenueActual ?? row.actualRevenue),
      market_cap: toNullableNumber(row.marketCap ?? row.market_cap),
      sector: toNullableString(row.sector),
      industry: toNullableString(row.industry),
    }))
    .filter((row) => row.report_date)
    .sort((left, right) => parseDate(right.report_date) - parseDate(left.report_date));
}

function hasEarningsData(earnings) {
  return Boolean(earnings?.latest || earnings?.next);
}

function buildEarningsPayload(rows) {
  const normalizedRows = toArray(rows)
    .map((row) => normalizeEarningsRecord(row))
    .filter(Boolean)
    .sort((left, right) => parseDate(right.report_date) - parseDate(left.report_date));

  if (!normalizedRows.length) {
    return {
      latest: null,
      next: null,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const latest = normalizedRows.find((row) => parseDate(row.report_date) !== null && parseDate(row.report_date) <= todayMs) || null;
  const next = [...normalizedRows].reverse().find((row) => parseDate(row.report_date) !== null && parseDate(row.report_date) >= todayMs) || null;

  return {
    latest,
    next,
  };
}

async function ensureEarningsSchema() {
  await queryWithTimeout(
    `ALTER TABLE earnings_events
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
       ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'unknown'`,
    [],
    {
      timeoutMs: 3000,
      label: 'research.earnings.ensure_columns',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await queryWithTimeout(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'earnings_events_symbol_report_date_key'
           AND conrelid = 'earnings_events'::regclass
       ) THEN
         ALTER TABLE earnings_events
           ADD CONSTRAINT earnings_events_symbol_report_date_key UNIQUE (symbol, report_date);
       END IF;
     END$$`,
    [],
    {
      timeoutMs: 3000,
      label: 'research.earnings.ensure_unique',
      maxRetries: 0,
      poolType: 'write',
    }
  );
}

async function ensureEarningsSchemaReady(existingTables) {
  if (!existingTables?.has('earnings_events')) {
    return;
  }

  if (!ensureEarningsSchemaPromise) {
    ensureEarningsSchemaPromise = ensureEarningsSchema().catch((error) => {
      ensureEarningsSchemaPromise = null;
      throw error;
    });
  }

  return ensureEarningsSchemaPromise;
}

async function fetchFmpEarningsRows(symbol, timeoutMs = FMP_TIMEOUT_MS) {
  if (!FMP_API_KEY) {
    return [];
  }

  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 730);
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + 180);

  const [surprisesResponse, calendarResponse] = await Promise.all([
    axios.get(`${FMP_BASE}/earnings-surprises`, {
      params: {
        symbol,
        apikey: FMP_API_KEY,
      },
      timeout: timeoutMs,
      validateStatus: () => true,
    }),
    axios.get(`${FMP_BASE}/earnings-calendar`, {
      params: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        apikey: FMP_API_KEY,
      },
      timeout: timeoutMs,
      validateStatus: () => true,
    }),
  ]);

  const surprises = surprisesResponse.status === 200
    ? normalizeFmpEarningsRows(surprisesResponse.data, symbol)
    : [];
  const calendar = calendarResponse.status === 200
    ? normalizeFmpEarningsRows(calendarResponse.data, symbol)
    : [];

  return [...surprises, ...calendar]
    .sort((left, right) => parseDate(right.report_date) - parseDate(left.report_date))
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.report_date === row.report_date) === index);
}

async function persistFmpEarningsRows(symbol, rows) {
  if (!symbol || !toArray(rows).length) {
    return false;
  }

  try {
    const payload = rows.map((row) => ({
      symbol,
      report_date: row.report_date,
      report_time: row.report_time,
      eps_estimate: row.eps_estimate,
      eps_actual: row.eps_actual,
      revenue_estimate: row.revenue_estimate,
      revenue_actual: row.revenue_actual,
      market_cap: row.market_cap,
      sector: row.sector,
      industry: row.industry,
      source: 'fmp_fallback',
      updated_at: new Date().toISOString(),
    }));

    const result = await queryWithTimeout(
      `WITH payload AS (
         SELECT *
         FROM json_to_recordset($1::json) AS x(
           symbol text,
           report_date date,
           report_time text,
           eps_estimate numeric,
           eps_actual numeric,
           revenue_estimate numeric,
           revenue_actual numeric,
           market_cap numeric,
           sector text,
           industry text,
           source text,
           updated_at timestamptz
         )
       ), upserted AS (
         INSERT INTO earnings_events (
           symbol,
           report_date,
           report_time,
           eps_estimate,
           eps_actual,
           rev_estimate,
           rev_actual,
           market_cap,
           sector,
           industry,
           source,
           updated_at
         )
         SELECT
           symbol,
           report_date,
           report_time,
           eps_estimate,
           eps_actual,
           revenue_estimate,
           revenue_actual,
           market_cap,
           sector,
           industry,
           source,
           updated_at
         FROM payload
         WHERE symbol IS NOT NULL
           AND NULLIF(BTRIM(symbol), '') IS NOT NULL
           AND report_date IS NOT NULL
         ON CONFLICT (symbol, report_date)
         DO UPDATE SET
           report_time = EXCLUDED.report_time,
           eps_estimate = EXCLUDED.eps_estimate,
           eps_actual = EXCLUDED.eps_actual,
           rev_estimate = EXCLUDED.rev_estimate,
           rev_actual = EXCLUDED.rev_actual,
           market_cap = EXCLUDED.market_cap,
           sector = EXCLUDED.sector,
           industry = EXCLUDED.industry,
           source = EXCLUDED.source,
           updated_at = NOW()
         RETURNING 1
       )
       SELECT COUNT(*)::int AS upserted FROM upserted`,
      [JSON.stringify(payload)],
      {
        timeoutMs: 1000,
        label: 'research.earnings.persist',
        maxRetries: 0,
        poolType: 'write',
      }
    );

    return Number(result.rows?.[0]?.upserted || 0) > 0;
  } catch (_error) {
    return false;
  }
}

async function hydrateEarningsFromFmp(symbol, options = {}) {
  const { persist = true, timeoutMs = FMP_TIMEOUT_MS } = options;

  try {
    const rows = await fetchFmpEarningsRows(symbol, timeoutMs);
    const earnings = buildEarningsPayload(rows);

    let persisted = false;
    if (persist && hasEarningsData(earnings)) {
      persisted = await persistFmpEarningsRows(symbol, rows);
    }

    console.log('[EARNINGS]', {
      symbol,
      source: 'fmp_fallback',
      persisted,
    });

    return {
      earnings,
      persisted,
    };
  } catch (_error) {
    console.log('[EARNINGS]', {
      symbol,
      source: 'fmp_fallback',
      persisted: false,
    });

    return {
      earnings: {
        latest: null,
        next: null,
      },
      persisted: false,
    };
  }
}

function scheduleBackgroundEarningsRefresh(symbol) {
  if (!symbol || !FMP_API_KEY || earningsRefreshInFlight.has(symbol)) {
    return;
  }

  const refreshPromise = hydrateEarningsFromFmp(symbol, {
    persist: true,
    timeoutMs: FMP_TIMEOUT_MS,
  }).finally(() => {
    earningsRefreshInFlight.delete(symbol);
  });

  earningsRefreshInFlight.set(symbol, refreshPromise);
}

function normalizeCompanyRecord(data, symbol) {
  const record = asObject(data);
  if (Object.keys(record).length === 0) {
    return {};
  }

  return {
    symbol,
    company_name: toNullableString(record.company_name) || toNullableString(record.name),
    sector: toNullableString(record.sector),
    industry: toNullableString(record.industry),
    description: toNullableString(record.description),
    exchange: toNullableString(record.exchange),
    country: toNullableString(record.country),
    website: toNullableString(record.website),
    updated_at: record.updated_at || null,
  };
}

function isMeaningfulCompanyValue(value) {
  const text = String(value || '').trim();
  return Boolean(text) && !/^(unknown|n\/a|na|--|none)$/i.test(text);
}

function isCompanyProfileComplete(company) {
  return [company?.country, company?.exchange, company?.sector, company?.industry].every(isMeaningfulCompanyValue);
}

function mergeCompanyRecords(primary, fallback) {
  return {
    ...asObject(fallback),
    ...asObject(primary),
    company_name: toNullableString(primary?.company_name) || toNullableString(fallback?.company_name),
    sector: toNullableString(primary?.sector) || toNullableString(fallback?.sector),
    industry: toNullableString(primary?.industry) || toNullableString(fallback?.industry),
    description: toNullableString(primary?.description) || toNullableString(fallback?.description),
    exchange: toNullableString(primary?.exchange) || toNullableString(fallback?.exchange),
    country: toNullableString(primary?.country) || toNullableString(fallback?.country),
    website: toNullableString(primary?.website) || toNullableString(fallback?.website),
    updated_at: primary?.updated_at || fallback?.updated_at || null,
  };
}

function normalizeFmpCompanyProfile(data, symbol) {
  const row = toArray(data).map((item) => asObject(item)).find((item) => normalizeSymbol(item.symbol || symbol) === symbol) || null;
  if (!row) {
    return {};
  }

  return {
    symbol,
    company_name: toNullableString(row.companyName || row.name),
    sector: toNullableString(row.sector),
    industry: toNullableString(row.industry),
    description: toNullableString(row.description),
    exchange: toNullableString(row.exchangeShortName || row.exchange),
    country: toNullableString(row.country),
    website: toNullableString(row.website),
    updated_at: new Date().toISOString(),
  };
}

async function fetchFmpCompanyProfile(symbol, timeoutMs = COMPANY_PROFILE_TIMEOUT_MS) {
  if (!FMP_API_KEY || !symbol) {
    return {};
  }

  const response = await axios.get(`${FMP_BASE}/profile`, {
    params: {
      symbol,
      apikey: FMP_API_KEY,
    },
    timeout: timeoutMs,
    validateStatus: () => true,
  });

  if (response.status !== 200) {
    return {};
  }

  return normalizeFmpCompanyProfile(response.data, symbol);
}

async function persistCompanyProfile(profile) {
  const record = asObject(profile);
  if (!record.symbol) {
    return false;
  }

  try {
    await queryWithTimeout(
      `INSERT INTO company_profiles (
         symbol,
         company_name,
         sector,
         industry,
         exchange,
         country,
         website,
         description,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (symbol)
       DO UPDATE SET
         company_name = COALESCE(EXCLUDED.company_name, company_profiles.company_name),
         sector = COALESCE(EXCLUDED.sector, company_profiles.sector),
         industry = COALESCE(EXCLUDED.industry, company_profiles.industry),
         exchange = COALESCE(EXCLUDED.exchange, company_profiles.exchange),
         country = COALESCE(EXCLUDED.country, company_profiles.country),
         website = COALESCE(EXCLUDED.website, company_profiles.website),
         description = COALESCE(EXCLUDED.description, company_profiles.description),
         updated_at = NOW()`,
      [
        record.symbol,
        record.company_name,
        record.sector,
        record.industry,
        record.exchange,
        record.country,
        record.website,
        record.description,
      ],
      {
        timeoutMs: 1000,
        label: 'research.company.persist',
        maxRetries: 0,
        poolType: 'write',
      }
    );

    return true;
  } catch (_error) {
    return false;
  }
}

async function hydrateCompanyProfile(symbol, company) {
  if (!symbol || isCompanyProfileComplete(company)) {
    return asObject(company);
  }

  try {
    const fetched = await fetchFmpCompanyProfile(symbol, COMPANY_PROFILE_TIMEOUT_MS);
    if (!Object.keys(fetched).length) {
      return asObject(company);
    }

    const persisted = await persistCompanyProfile(fetched);
    console.log('[COMPANY_PROFILE]', {
      symbol,
      source: 'fmp_profile',
      persisted,
    });

    return mergeCompanyRecords(fetched, company);
  } catch (_error) {
    return asObject(company);
  }
}

function parseDate(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIsoDate(value) {
  const parsed = parseDate(value);
  return parsed === null ? null : new Date(parsed);
}

function inferEarningsCadenceDays(rows = []) {
  const dates = rows
    .map((row) => parseDate(row?.report_date))
    .filter((value) => value !== null)
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
  return Math.max(75, Math.min(105, gaps[Math.floor(gaps.length / 2)] || 90));
}

function projectNextEarningsFromHistory(symbol, rows = []) {
  if (rows.length < 2) {
    return null;
  }

  const orderedRows = [...rows]
    .map((row) => normalizeEarningsRecord({ ...row, symbol }))
    .filter(Boolean)
    .filter((row) => row.report_date)
    .sort((left, right) => parseDate(right.report_date) - parseDate(left.report_date));

  if (orderedRows.length < 2) {
    return null;
  }

  const cadenceDays = inferEarningsCadenceDays(orderedRows);
  let nextDate = parseIsoDate(orderedRows[0].report_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!nextDate) {
    return null;
  }

  do {
    nextDate.setUTCDate(nextDate.getUTCDate() + cadenceDays);
  } while (nextDate < today);

  return {
    symbol,
    report_date: nextDate.toISOString().slice(0, 10),
    report_time: orderedRows[0].report_time || null,
    eps_estimate: orderedRows[0].eps_estimate ?? null,
    eps_actual: null,
    revenue_estimate: orderedRows[0].revenue_estimate ?? null,
    revenue_actual: null,
    market_cap: orderedRows[0].market_cap ?? null,
    sector: orderedRows[0].sector ?? null,
    industry: orderedRows[0].industry ?? null,
  };
}

function hasRecentNews(news) {
  const now = Date.now();
  return toArray(news).some((item) => {
    const publishedAt = parseDate(item?.published_at);
    return publishedAt !== null && (now - publishedAt) <= 24 * 60 * 60 * 1000;
  });
}

function hasUpcomingEarnings(earnings) {
  const nextDate = parseDate(earnings?.next?.report_date);
  if (nextDate === null) {
    return false;
  }

  const daysUntil = (nextDate - Date.now()) / (24 * 60 * 60 * 1000);
  return daysUntil >= 0 && daysUntil <= 3;
}

function getRecentRange(chart) {
  const candles = toArray(chart?.daily).length ? toArray(chart.daily) : toArray(chart?.intraday);
  if (!candles.length) {
    return {
      recentHigh: null,
      recentLow: null,
      priorHigh: null,
      priorLow: null,
    };
  }

  const recentWindow = candles.slice(-20);
  const priorWindow = recentWindow.length > 1 ? recentWindow.slice(0, -1) : recentWindow;
  const highs = recentWindow.map((row) => toNullableNumber(row.high)).filter((value) => value !== null);
  const lows = recentWindow.map((row) => toNullableNumber(row.low)).filter((value) => value !== null);
  const priorHighs = priorWindow.map((row) => toNullableNumber(row.high)).filter((value) => value !== null);
  const priorLows = priorWindow.map((row) => toNullableNumber(row.low)).filter((value) => value !== null);

  return {
    recentHigh: highs.length ? Math.max(...highs) : null,
    recentLow: lows.length ? Math.min(...lows) : null,
    priorHigh: priorHighs.length ? Math.max(...priorHighs) : null,
    priorLow: priorLows.length ? Math.min(...priorLows) : null,
  };
}

function formatLevel(value) {
  const numeric = toNullableNumber(value);
  if (numeric === null) {
    return '0.00';
  }

  return numeric.toFixed(2);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getExpectedMoveLabel(percent) {
  const numeric = toNullableNumber(percent);
  if (numeric === null || numeric < 2) {
    return 'LOW';
  }
  if (numeric <= 5) {
    return 'MEDIUM';
  }
  return 'HIGH';
}

function buildMCP(researchData) {
  try {
    const market = asObject(researchData?.market);
    const technicals = asObject(researchData?.technicals);
    const earnings = asObject(researchData?.earnings);
    const news = toArray(researchData?.news);

    const price = toNullableNumber(market.price);
    const relativeVolume = toNullableNumber(market.relative_volume ?? technicals.relative_volume) ?? 0;
    const sma20 = toNullableNumber(technicals.sma_20);
    const sma50 = toNullableNumber(technicals.sma_50);
    const vwap = toNullableNumber(market.vwap ?? technicals.vwap);
    const recentNews = hasRecentNews(news);
    const upcomingEarnings = hasUpcomingEarnings(earnings);
    const highVolume = relativeVolume > 1.5;

    let catalystStrength = 'NONE';
    if (upcomingEarnings) {
      catalystStrength = 'HIGH';
    } else if (recentNews && highVolume) {
      catalystStrength = 'MEDIUM';
    } else if (recentNews) {
      catalystStrength = 'LOW';
    }

    let why = 'No clear catalyst, move appears technically driven and indicates low conviction.';
    if (catalystStrength === 'HIGH') {
      why = 'Move driven by earnings expectations or reaction, showing strong participation and momentum.';
    } else if (catalystStrength === 'MEDIUM') {
      why = 'News flow is active and volume is confirming participation, but the move still needs full price confirmation.';
    } else if (catalystStrength === 'LOW') {
      why = 'News flow is present but lacks a strong catalyst, suggesting limited conviction.';
    } else if (highVolume) {
      why = 'Elevated volume without clear news suggests positioning or speculative activity.';
    }

    const { recentHigh, recentLow, priorHigh, priorLow } = getRecentRange(researchData?.chart);
    const upperLevel = formatLevel(recentHigh);
    const lowerLevel = formatLevel(recentLow);

    let what = `Range-bound between ${lowerLevel} and ${upperLevel}`;
    let trendState = 'RANGE';
    if (price !== null && sma20 !== null && sma50 !== null) {
      if (price > sma20 && sma20 > sma50) {
        trendState = 'STRONG_UPTREND';
        what = 'Strong uptrend with price above SMA20 and SMA50';
      } else if (price < sma20 && sma20 < sma50) {
        trendState = 'STRONG_DOWNTREND';
        what = 'Strong downtrend with price below SMA20 and SMA50';
      } else if (price > sma20 && sma20 < sma50) {
        trendState = 'EARLY_REVERSAL';
        what = 'Early reversal attempt with price reclaiming SMA20 below SMA50';
      }
    }

    const breakoutLevel = trendState === 'STRONG_DOWNTREND'
      ? (priorLow ?? recentLow)
      : (priorHigh ?? recentHigh);
    const breakout = price !== null && breakoutLevel !== null && (
      (trendState === 'STRONG_DOWNTREND' && price <= breakoutLevel)
      || (trendState !== 'STRONG_DOWNTREND' && price >= breakoutLevel)
    );
    const distanceToVwap = price !== null && vwap !== null && price > vwap ? 'ABOVE_VWAP' : 'BELOW_VWAP';

    const where = `Watch breakout above ${upperLevel} or breakdown below ${lowerLevel}`;

    let when = 'Wait for breakout with volume confirmation';
    if (!recentNews && !upcomingEarnings && relativeVolume < 1) {
      when = 'Avoid until catalyst emerges';
    } else if (breakout && highVolume && trendState !== 'STRONG_DOWNTREND') {
      when = 'Entry valid on breakout above resistance';
    } else if (breakout && highVolume && trendState === 'STRONG_DOWNTREND') {
      when = 'Entry valid on breakdown below support';
    }

    let confidence = 0;
    if (catalystStrength === 'HIGH') {
      confidence += 40;
    } else if (catalystStrength === 'MEDIUM') {
      confidence += 25;
    }
    if (highVolume) {
      confidence += 25;
    }
    if (trendState === 'STRONG_UPTREND' || trendState === 'STRONG_DOWNTREND') {
      confidence += 20;
    }
    if (distanceToVwap === 'ABOVE_VWAP') {
      confidence += 10;
    }
    confidence = clampNumber(confidence, 0, 100);

    const expectedMoveValue = toNullableNumber(technicals.atr)
      ?? ((recentHigh !== null && recentLow !== null) ? Math.max(recentHigh - recentLow, 0) : null);
    const expectedMovePercent = price !== null && price > 0 && expectedMoveValue !== null
      ? (expectedMoveValue / price) * 100
      : null;
    const expectedMove = {
      value: expectedMoveValue,
      percent: expectedMovePercent,
      label: getExpectedMoveLabel(expectedMovePercent),
    };

    const entry = breakoutLevel;
    const invalidation = trendState === 'STRONG_DOWNTREND'
      ? (recentHigh ?? priorHigh)
      : (recentLow ?? priorLow);
    const reward = expectedMoveValue;
    const riskDistance = entry !== null && invalidation !== null
      ? Math.abs(entry - invalidation)
      : null;
    const rr = reward !== null && riskDistance !== null && riskDistance > 0
      ? reward / riskDistance
      : null;
    const risk = {
      entry,
      invalidation,
      reward,
      rr,
    };

    const tradeScore = clampNumber(
      (confidence * 0.5)
      + (highVolume ? 15 : 0)
      + (catalystStrength === 'HIGH' ? 20 : catalystStrength === 'MEDIUM' ? 10 : 0)
      + (trendState === 'STRONG_UPTREND' ? 15 : 0),
      0,
      100
    );

    let action = 'AVOID';
    if (tradeScore >= 75 && rr !== null && rr >= 2) {
      action = 'BUY';
    } else if (tradeScore >= 50) {
      action = 'WATCH';
    }

    let confidenceReason = 'Limited due to lack of catalyst and weak structure.';
    if (action === 'BUY') {
      confidenceReason = 'High due to catalyst strength, volume confirmation, trend alignment, and favorable reward-to-risk.';
    } else if (catalystStrength === 'HIGH') {
      confidenceReason = 'Strong catalyst is present, but the setup still lacks full confirmation across trend, volume, or VWAP position.';
    } else if (catalystStrength === 'MEDIUM') {
      confidenceReason = 'Moderate due to partial catalyst support and participation, but confirmation is still incomplete.';
    } else if (catalystStrength === 'LOW') {
      confidenceReason = 'Limited due to weak news flow without confirmed catalyst follow-through.';
    } else if (highVolume && !recentNews) {
      confidenceReason = 'Improves on volume, but lacks catalyst confirmation.';
    } else if (trendState === 'STRONG_UPTREND' || trendState === 'STRONG_DOWNTREND') {
      confidenceReason = 'Supported by structure, but limited due to missing catalyst.';
    }

    let tradeQuality = 'LOW';
    if (action === 'BUY') {
      tradeQuality = 'HIGH';
    } else if (action === 'WATCH') {
      tradeQuality = 'MEDIUM';
    }

    const improveConditions = [];
    if (catalystStrength === 'NONE') {
      improveConditions.push('Confirmed catalyst');
    } else if (catalystStrength === 'LOW') {
      improveConditions.push('Stronger catalyst follow-through');
    }
    if (!breakout) {
      improveConditions.push('Break above resistance');
    }
    if (distanceToVwap !== 'ABOVE_VWAP') {
      improveConditions.push('Hold above VWAP');
    }
    if (!highVolume) {
      improveConditions.push('Volume expansion');
    }
    if (trendState !== 'STRONG_UPTREND') {
      improveConditions.push('Cleaner bullish trend structure');
    }

    const improve = improveConditions.length
      ? `Needs:\n- ${improveConditions.join('\n- ')}`
      : 'Conditions aligned.';

    let summary = 'No edge - avoid until conditions improve';
    if (action === 'BUY') {
      summary = 'High-quality setup with catalyst and confirmation - tradeable now';
    } else if (action === 'WATCH') {
      summary = 'Developing setup - wait for confirmation';
    }

    console.log('MCP FINAL:', {
      tradeScore,
      rr,
      expected_move: expectedMove,
    });

    return {
      summary,
      why,
      what,
      where,
      when,
      confidence,
      confidence_reason: confidenceReason,
      trade_quality: tradeQuality,
      improve: improve,
      action,
      trade_score: tradeScore,
      expected_move: expectedMove,
      risk,
    };
  } catch (error) {
    console.warn('[RESEARCH] buildMCP failed', error.message);
    return getDefaultMCP(normalizeSymbol(researchData?.symbol || 'UNKNOWN'));
  }
}

async function getResearchData(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const payload = emptyResearchData(normalizedSymbol);
  const existingTables = new Set(REQUIRED_TABLES);
  const warnings = payload.warnings;

  try {
    await ensureEarningsSchemaReady(existingTables);
  } catch (error) {
    warnings.push(`earnings_events: ${error.message}`);
  }

  const [marketRows, intradayRows, dailyRows, newsRows, earningsRows, companyRows] = await Promise.all([
    safeQuery(
      existingTables,
      'market_quotes',
      `SELECT
         COALESCE((SELECT to_jsonb(q) FROM market_quotes q WHERE q.symbol = $1 LIMIT 1), '{}'::jsonb) AS quote,
         COALESCE((SELECT to_jsonb(m) FROM market_metrics m WHERE m.symbol = $1 LIMIT 1), '{}'::jsonb) AS metrics`,
      [normalizedSymbol],
      {
        timeoutMs: 3000,
        label: 'research.market',
      },
      warnings,
      []
    ),
    safeQuery(
      existingTables,
      'intraday_1m',
      `SELECT
         EXTRACT(EPOCH FROM "timestamp")::bigint AS time,
         open,
         high,
         low,
         close,
         volume
       FROM intraday_1m
       WHERE symbol = $1
       ORDER BY "timestamp" DESC
       LIMIT 100`,
      [normalizedSymbol],
      {
        timeoutMs: 4000,
        label: 'research.chart.intraday',
      },
      warnings,
      []
    ),
    safeQuery(
      existingTables,
      'daily_ohlc',
      `SELECT
         EXTRACT(EPOCH FROM date)::bigint AS time,
         open,
         high,
         low,
         close,
         volume
       FROM daily_ohlc
       WHERE symbol = $1
       ORDER BY date DESC
       LIMIT 100`,
      [normalizedSymbol],
      {
        timeoutMs: 4000,
        label: 'research.chart.daily',
      },
      warnings,
      []
    ),
    safeQuery(
      existingTables,
      'news_articles',
      `SELECT to_jsonb(n) AS data
       FROM news_articles n
       WHERE UPPER(COALESCE(n.symbol, '')) = $1
          OR (
            COALESCE(n.symbol, '') = ''
            AND EXISTS (
              SELECT 1
              FROM unnest(COALESCE(n.symbols, ARRAY[]::text[])) AS symbol_ref(symbol)
              WHERE UPPER(symbol_ref.symbol) = $1
            )
          )
       ORDER BY n.published_at DESC
       LIMIT 20`,
      [normalizedSymbol],
      {
        timeoutMs: 3000,
        label: 'research.news',
      },
      warnings,
      []
    ),
    safeQuery(
      existingTables,
      'earnings_events',
      `SELECT
         COALESCE((
           SELECT to_jsonb(e)
           FROM earnings_events e
           WHERE e.symbol = $1
             AND e.report_date <= CURRENT_DATE
           ORDER BY e.report_date DESC
           LIMIT 1
         ), '{}'::jsonb) AS latest,
         COALESCE((
           SELECT to_jsonb(e)
           FROM earnings_events e
           WHERE e.symbol = $1
             AND e.report_date >= CURRENT_DATE
           ORDER BY e.report_date ASC
           LIMIT 1
         ), '{}'::jsonb) AS next,
         EXISTS(
           SELECT 1
           FROM earnings_events e
           WHERE e.symbol = $1
             AND e.report_date > NOW() - INTERVAL '${EARNINGS_CACHE_WINDOW_DAYS} days'
         ) AS has_recent_rows,
         (
           SELECT MAX(COALESCE(e.updated_at, e.created_at))
           FROM earnings_events e
           WHERE e.symbol = $1
         ) AS last_updated_at`,
      [normalizedSymbol],
      {
        timeoutMs: 3000,
        label: 'research.earnings',
      },
      warnings,
      []
    ),
    safeQuery(
      existingTables,
      'company_profiles',
      `SELECT to_jsonb(c) AS data
       FROM company_profiles c
       WHERE c.symbol = $1
       LIMIT 1`,
      [normalizedSymbol],
      {
        timeoutMs: 3000,
        label: 'research.company',
      },
      warnings,
      []
    ),
  ]);

  const projectedEarningsRows = await safeQuery(
    existingTables,
    'earnings_history',
    `SELECT report_date, report_time, eps_estimate, eps_actual, revenue_estimate, revenue_actual
     FROM earnings_history
     WHERE symbol = $1
       AND report_date < CURRENT_DATE
     ORDER BY report_date DESC
     LIMIT 4`,
    [normalizedSymbol],
    {
        timeoutMs: 3000,
      label: 'research.earnings.projected_history',
    },
    warnings,
    []
  );

  const marketRow = marketRows[0] || { quote: {}, metrics: {} };
  payload.market = normalizeMarketRow(marketRow);
  payload.technicals = normalizeTechnicalsRow(marketRow);
  payload.chart.intraday = normalizeCandleRows(intradayRows);
  payload.chart.daily = normalizeCandleRows(dailyRows);
  payload.news = normalizeNewsRows(newsRows);
  payload.earnings = buildEarningsPayload([
    earningsRows[0]?.latest,
    earningsRows[0]?.next,
  ]);

  const hasRecentEarningsRows = Boolean(earningsRows[0]?.has_recent_rows);
  const lastUpdatedAt = parseDate(earningsRows[0]?.last_updated_at);
  const isStale = lastUpdatedAt !== null && (Date.now() - lastUpdatedAt) > EARNINGS_STALE_WINDOW_MS;

  if (!hasEarningsData(payload.earnings) && !hasRecentEarningsRows) {
    const fallbackResult = await hydrateEarningsFromFmp(normalizedSymbol, {
      persist: true,
      timeoutMs: FMP_TIMEOUT_MS,
    });

    payload.earnings = fallbackResult.earnings;
  } else {
    console.log('[EARNINGS]', {
      symbol: normalizedSymbol,
      source: 'db',
      persisted: false,
    });

    if ((hasRecentEarningsRows || hasEarningsData(payload.earnings)) && isStale) {
      scheduleBackgroundEarningsRefresh(normalizedSymbol);
    }
  }

  if (!payload.earnings.next) {
    const projectedNext = projectNextEarningsFromHistory(normalizedSymbol, projectedEarningsRows);
    if (projectedNext) {
      payload.earnings = {
        ...payload.earnings,
        next: projectedNext,
      };
      warnings.push('earnings_projected_from_history');
    }
  }

  payload.company = normalizeCompanyRecord(companyRows[0]?.data, normalizedSymbol);

  if (!isCompanyProfileComplete(payload.company)) {
    payload.company = await hydrateCompanyProfile(normalizedSymbol, payload.company);
  }

  if (!payload.company.sector) {
    payload.company.sector = payload.earnings.next?.sector || payload.earnings.latest?.sector || null;
  }

  if (!payload.company.industry) {
    payload.company.industry = payload.earnings.next?.industry || payload.earnings.latest?.industry || null;
  }

  payload.mcp = buildMCP(payload);
  Object.assign(payload, computeCompletenessConfidence({
    has_price: payload.market?.price !== null && payload.market?.price !== undefined,
    has_volume: payload.market?.volume !== null && payload.market?.volume !== undefined,
    has_chart_data: hasChartCandles(payload.chart),
    has_technicals: hasCompleteTechnicals(payload.technicals),
    has_earnings: Boolean(payload.earnings?.next?.report_date),
  }));

  return payload;
}

module.exports = {
  buildMCP,
  emptyResearchData,
  getResearchData,
  normalizeSymbol,
};
