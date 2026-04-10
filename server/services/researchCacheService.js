const { queryWithTimeout } = require('../db/pg');
const { fmpFetch } = require('./fmpClient');
const { generateNarrative } = require('./gptService');
const { getMarketRegime } = require('./marketRegime');
const { normalizeReportTime } = require('./earningsIntelligence');
const { ensureEarningsSchema, fetchNextEventForSymbol } = require('../engines/earningsIngestionEngine');

const PROFILE_TTL_MS = 15 * 60 * 1000;
const PRICE_TTL_MARKET_HOURS_MS = 30 * 1000;
const PRICE_TTL_OFF_HOURS_MS = 15 * 60 * 1000;
const FUNDAMENTALS_TTL_MS = 15 * 60 * 1000;
const OWNERSHIP_TTL_MS = 15 * 60 * 1000;
const EARNINGS_TTL_MS = 60 * 60 * 1000;
const EARNINGS_FRESH_TTL_MS = 24 * 60 * 60 * 1000;
const EARNINGS_SOON_DAYS = 7;
const MARKET_CONTEXT_TTL_MARKET_HOURS_MS = 5 * 60 * 1000;
const MARKET_CONTEXT_TTL_OFF_HOURS_MS = 15 * 60 * 1000;
const DEFAULT_SECTOR_GROUPS = ['Technology', 'Healthcare', 'Financials', 'Energy', 'Consumer'];

let schemaReadyPromise = null;

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
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

function isMarketHours(date = new Date()) {
  const { weekday, hour, minute } = getEasternTimeParts(date);
  if (weekday === 'Sat' || weekday === 'Sun') {
    return false;
  }

  const minutes = hour * 60 + minute;
  return minutes >= 570 && minutes <= 960;
}

function getPriceTtlMs() {
  return isMarketHours() ? PRICE_TTL_MARKET_HOURS_MS : PRICE_TTL_OFF_HOURS_MS;
}

function getMarketContextTtlMs() {
  return isMarketHours() ? MARKET_CONTEXT_TTL_MARKET_HOURS_MS : MARKET_CONTEXT_TTL_OFF_HOURS_MS;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toPositiveNumber(value) {
  const numeric = toNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function toMeaningfulNumber(value) {
  const numeric = toNumber(value);
  return numeric !== null && numeric !== 0 ? numeric : null;
}

function toStringValue(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toDisplayTime(value) {
  return normalizeReportTime(value) || toStringValue(value);
}

function normalizeSectorGroup(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (text.includes('tech')) return 'Technology';
  if (text.includes('health')) return 'Healthcare';
  if (text.includes('financial') || text.includes('bank') || text.includes('insurance') || text.includes('capital')) return 'Financials';
  if (text.includes('energy') || text.includes('oil') || text.includes('gas')) return 'Energy';
  if (text.includes('consumer') || text.includes('retail') || text.includes('restaurant') || text.includes('travel') || text.includes('leisure')) return 'Consumer';
  return null;
}

function getRegimeBias(regime) {
  if (regime === 'RISK_OFF') return 'Avoid Risk';
  if (regime === 'MIXED') return 'Mean Reversion';
  return 'Momentum Favoured';
}

function hasSectorTailwind(profileSector, leaders) {
  const normalizedProfileSector = normalizeSectorGroup(profileSector) || toStringValue(profileSector);
  if (!normalizedProfileSector) {
    return false;
  }

  return (Array.isArray(leaders) ? leaders : []).some((item) => {
    const leaderSector = normalizeSectorGroup(item?.sector) || toStringValue(item?.sector);
    return leaderSector && leaderSector === normalizedProfileSector && Number(item?.change || 0) >= 0;
  });
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function daysUntilIsoDate(value) {
  const parsed = parseTimestamp(value);
  if (parsed === null) {
    return null;
  }

  const today = new Date();
  const currentDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const target = new Date(parsed);
  const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((targetDay - currentDay) / 86400000);
}

function isFresh(value, ttlMs) {
  const parsed = parseTimestamp(value);
  return parsed !== null && (Date.now() - parsed) < ttlMs;
}

function isEarningsEventSoon(nextEvent) {
  const days = daysUntilIsoDate(nextEvent?.date);
  return days !== null && days >= 0 && days <= EARNINGS_SOON_DAYS;
}

function mergeExpectedMove(nextEvent, atrMovePercent) {
  if (!nextEvent) {
    return null;
  }

  const earningsMove = toPositiveNumber(nextEvent.expected_move_percent ?? nextEvent.expectedMove);
  if (isEarningsEventSoon(nextEvent)) {
    if (earningsMove !== null && atrMovePercent !== null) {
      return Number(Math.max(earningsMove, atrMovePercent).toFixed(2));
    }
    return earningsMove ?? atrMovePercent;
  }

  return earningsMove ?? atrMovePercent;
}

function classifyUpcomingStatus(nextEvent) {
  if (!nextEvent?.date) {
    return 'none';
  }

  const hasTime = Boolean(nextEvent.report_time && String(nextEvent.report_time).trim() && String(nextEvent.report_time).trim().toUpperCase() !== 'TBD');
  const hasEstimate = toNumber(nextEvent.eps_estimate ?? nextEvent.epsEstimated) !== null;
  const hasExpectedMove = toPositiveNumber(nextEvent.expected_move_percent ?? nextEvent.expectedMove) !== null;

  return hasTime && hasEstimate && hasExpectedMove ? 'full' : 'partial';
}

function buildUpcomingRead(status, nextEvent) {
  if (status === 'none') {
    return 'No upcoming earnings scheduled.';
  }

  if (status === 'partial') {
    return nextEvent?.date
      ? 'Upcoming earnings scheduled. Some event details are still estimating.'
      : 'Upcoming earnings details are still estimating.';
  }

  return 'Upcoming earnings schedule confirmed.';
}

function firstRow(payload) {
  return Array.isArray(payload) ? (payload[0] || null) : (payload || null);
}

function firstArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  return [];
}

function parseJsonValue(value, fallback) {
  if (!value) {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function currentYearQuarter(date = new Date()) {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return { year, quarter };
}

function getPreviousYearQuarter(year, quarter) {
  if (quarter > 1) {
    return { year, quarter: quarter - 1 };
  }

  return { year: year - 1, quarter: 4 };
}

function buildRecentQuarterSequence(limit = 4) {
  const periods = [];
  let { year, quarter } = currentYearQuarter();

  for (let index = 0; index < limit; index += 1) {
    periods.push({ year, quarter });
    ({ year, quarter } = getPreviousYearQuarter(year, quarter));
  }

  return periods;
}

function formatRelativeDays(dateValue) {
  const parsed = parseTimestamp(dateValue);
  if (parsed === null) {
    return null;
  }

  const days = Math.max(0, Math.round((Date.now() - parsed) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function formatMoneyCompact(value) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return null;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: Math.abs(numeric) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(numeric) >= 1000 ? 2 : 0,
  }).format(numeric);
}

function buildInsiderTrend(totalBought, totalSold) {
  const bought = toNumber(totalBought) ?? 0;
  const sold = toNumber(totalSold) ?? 0;
  if (bought > sold) return 'bullish';
  if (sold > bought) return 'bearish';
  return 'neutral';
}

function buildRecentInsiderBuySummary(rows) {
  const trades = firstArray(rows);
  const acquisition = trades.find((row) => String(row?.acquisitionOrDisposition || row?.acquisition_disposition || row?.type || '').trim().toUpperCase() === 'A');
  if (!acquisition) {
    return null;
  }

  const person = toStringValue(acquisition.reportingName || acquisition.reporting_name || acquisition.name || acquisition.reportingCik) || 'Insider';
  const title = toStringValue(acquisition.typeOfOwner || acquisition.ownerTitle || acquisition.title);
  const value = formatMoneyCompact(acquisition.securitiesTransactedValue || acquisition.value || acquisition.transactionValue);
  const relative = formatRelativeDays(acquisition.filingDate || acquisition.transactionDate || acquisition.date);
  return [
    'Yes',
    title ? `(${title}` : '(',
    title ? `, ${person}` : person,
    value ? `, ${value}` : '',
    relative ? `, ${relative}` : '',
    ')',
  ].join('').replace('(, ', '(');
}

function buildRecentUpgradeSummary(rows) {
  const grades = firstArray(rows);
  const latest = grades.find((row) => {
    const action = String(row?.gradingCompanyAction || row?.action || row?.newsGradeAction || '').trim().toLowerCase();
    const newGrade = String(row?.newGrade || row?.rating || '').trim().toLowerCase();
    return action.includes('upgrade') || newGrade.includes('buy') || newGrade.includes('outperform') || newGrade.includes('overweight');
  }) || grades[0];

  if (!latest) {
    return null;
  }

  const firm = toStringValue(latest.gradingCompany || latest.analystCompany || latest.company) || 'Analyst';
  const newGrade = toStringValue(latest.newGrade || latest.rating || latest.new_grade);
  const published = latest.date || latest.publishedDate || latest.gradingDate;
  const dateLabel = published ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(published)) : null;
  if (!newGrade) {
    return null;
  }

  return `Yes (${firm} -> ${newGrade}${dateLabel ? `, ${dateLabel}` : ''})`;
}

function buildQuarterlyFundamentalTrends(rows) {
  return firstArray(rows)
    .slice(0, 8)
    .reverse()
    .map((row) => {
      const revenue = toNumber(row?.revenue);
      const grossProfit = toNumber(row?.grossProfit);
      const netIncome = toNumber(row?.netIncome);
      return {
        date: String(row?.date || '').slice(0, 10),
        revenue,
        eps: toNumber(row?.eps || row?.epsDiluted),
        gross_margin: toNumber(row?.grossProfitRatio) ?? (revenue && grossProfit !== null ? Number(((grossProfit / revenue) * 100).toFixed(2)) : null),
        net_margin: toNumber(row?.netIncomeRatio) ?? (revenue && netIncome !== null ? Number(((netIncome / revenue) * 100).toFixed(2)) : null),
      };
    })
    .filter((row) => row.date);
}

function formatIsoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function computePercentChange(price, previousClose) {
  const current = toNumber(price);
  const previous = toNumber(previousClose);
  if (current === null || previous === null || previous === 0) {
    return null;
  }

  return Number((((current - previous) / previous) * 100).toFixed(2));
}

function computeAtrFromCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 15) {
    return null;
  }

  const ordered = candles
    .map((row) => ({
      high: toNumber(row?.high),
      low: toNumber(row?.low),
      close: toNumber(row?.close),
    }))
    .filter((row) => row.high !== null && row.low !== null && row.close !== null);

  if (ordered.length < 15) {
    return null;
  }

  const ranges = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = ordered[index - 1];
    const trueRange = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    ranges.push(trueRange);
  }

  const lastFourteen = ranges.slice(-14);
  if (!lastFourteen.length) {
    return null;
  }

  const average = lastFourteen.reduce((sum, value) => sum + value, 0) / lastFourteen.length;
  return Number(average.toFixed(4));
}

async function getVolatilityProxyPriceData() {
  const symbols = ['VIX', 'VIXY', '^VIX'];
  for (const symbol of symbols) {
    const price = await getPriceData(symbol).catch(() => null);
    if (toNumber(price?.price) !== null && Number(price.price) > 0) {
      return price;
    }
  }

  return {
    symbol: 'VIX',
    price: null,
    change_percent: null,
    atr: null,
    updated_at: null,
    source: 'empty',
  };
}

async function safeQuery(sql, params, options) {
  return queryWithTimeout(sql, params, options).catch(() => ({ rows: [] }));
}

async function ensureResearchCacheSchema() {
  if (schemaReadyPromise) {
    return schemaReadyPromise;
  }

  schemaReadyPromise = (async () => {
    await ensureEarningsSchema();

    const statements = [
      `CREATE TABLE IF NOT EXISTS public.company_profiles (
         symbol TEXT PRIMARY KEY,
         company_name TEXT,
         sector TEXT,
         industry TEXT,
         exchange TEXT,
         country TEXT,
         website TEXT,
         description TEXT,
        market_cap NUMERIC,
        beta NUMERIC,
        pe NUMERIC,
        insider_ownership_percent NUMERIC,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      `CREATE TABLE IF NOT EXISTS public.fundamentals_snapshot (
         symbol TEXT PRIMARY KEY,
         revenue_growth NUMERIC,
         eps_growth NUMERIC,
         gross_margin NUMERIC,
         net_margin NUMERIC,
         free_cash_flow NUMERIC,
        pe NUMERIC,
        ps NUMERIC,
        pb NUMERIC,
        debt_to_equity NUMERIC,
        roe_percent NUMERIC,
        fcf_yield_percent NUMERIC,
        dividend_yield_percent NUMERIC,
        earnings_yield_percent NUMERIC,
        altman_z_score NUMERIC,
        piotroski_score NUMERIC,
        quarterly_trends_json JSONB,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      `CREATE TABLE IF NOT EXISTS public.ownership_snapshot (
         symbol TEXT PRIMARY KEY,
         institutional_ownership_percent NUMERIC,
         insider_trend TEXT,
         etf_exposure NUMERIC,
        investors_holding INTEGER,
        total_invested NUMERIC,
        new_positions INTEGER,
        increased_positions INTEGER,
        closed_positions INTEGER,
        reduced_positions INTEGER,
        put_call_ratio NUMERIC,
        etf_exposure_json JSONB,
        insider_total_bought NUMERIC,
        insider_total_sold NUMERIC,
        insider_buy_count INTEGER,
        insider_sell_count INTEGER,
        insider_summary TEXT,
        recent_insider_buy_summary TEXT,
        recent_upgrade_summary TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      `CREATE TABLE IF NOT EXISTS public.earnings_snapshot (
         symbol TEXT PRIMARY KEY,
         next_earnings_date DATE,
         eps_estimate NUMERIC,
         expected_move_percent NUMERIC,
         last_surprise_percent NUMERIC,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      `ALTER TABLE public.earnings_snapshot ADD COLUMN IF NOT EXISTS id BIGSERIAL`,
      `ALTER TABLE public.earnings_snapshot ADD COLUMN IF NOT EXISTS report_date DATE`,
      `ALTER TABLE public.earnings_snapshot ADD COLUMN IF NOT EXISTS eps_actual NUMERIC`,
      `ALTER TABLE public.earnings_snapshot ADD COLUMN IF NOT EXISTS actual_move_percent NUMERIC`,
      `ALTER TABLE public.earnings_snapshot ADD COLUMN IF NOT EXISTS beat BOOLEAN`,
      `CREATE TABLE IF NOT EXISTS public.macro_snapshot (
         id TEXT PRIMARY KEY,
         spy_trend TEXT,
         qqq_trend TEXT,
         vix_level NUMERIC,
         sector_strength_json JSONB,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      `CREATE TABLE IF NOT EXISTS public.market_narratives (
         id BIGSERIAL PRIMARY KEY,
         regime TEXT,
         narrative TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      `CREATE INDEX IF NOT EXISTS idx_market_narratives_regime_created_at
         ON public.market_narratives (regime, created_at DESC)`
      ,`ALTER TABLE public.company_profiles ADD COLUMN IF NOT EXISTS market_cap NUMERIC`
      ,`ALTER TABLE public.company_profiles ADD COLUMN IF NOT EXISTS beta NUMERIC`
      ,`ALTER TABLE public.company_profiles ADD COLUMN IF NOT EXISTS pe NUMERIC`
      ,`ALTER TABLE public.company_profiles ADD COLUMN IF NOT EXISTS insider_ownership_percent NUMERIC`
      ,`ALTER TABLE public.fundamentals_snapshot ADD COLUMN IF NOT EXISTS pe NUMERIC`
      ,`ALTER TABLE public.fundamentals_snapshot ADD COLUMN IF NOT EXISTS ps NUMERIC`
      ,`ALTER TABLE public.fundamentals_snapshot ADD COLUMN IF NOT EXISTS pb NUMERIC`
      ,`ALTER TABLE public.fundamentals_snapshot ADD COLUMN IF NOT EXISTS debt_to_equity NUMERIC`
      ,`ALTER TABLE public.fundamentals_snapshot ADD COLUMN IF NOT EXISTS roe_percent NUMERIC`
      ,`ALTER TABLE public.fundamentals_snapshot ADD COLUMN IF NOT EXISTS fcf_yield_percent NUMERIC`
      ,`ALTER TABLE public.fundamentals_snapshot ADD COLUMN IF NOT EXISTS dividend_yield_percent NUMERIC`
      ,`ALTER TABLE public.fundamentals_snapshot ADD COLUMN IF NOT EXISTS earnings_yield_percent NUMERIC`
      ,`ALTER TABLE public.fundamentals_snapshot ADD COLUMN IF NOT EXISTS altman_z_score NUMERIC`
      ,`ALTER TABLE public.fundamentals_snapshot ADD COLUMN IF NOT EXISTS piotroski_score NUMERIC`
      ,`ALTER TABLE public.fundamentals_snapshot ADD COLUMN IF NOT EXISTS quarterly_trends_json JSONB`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS investors_holding INTEGER`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS total_invested NUMERIC`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS new_positions INTEGER`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS increased_positions INTEGER`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS closed_positions INTEGER`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS reduced_positions INTEGER`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS put_call_ratio NUMERIC`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS etf_exposure_json JSONB`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS insider_total_bought NUMERIC`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS insider_total_sold NUMERIC`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS insider_buy_count INTEGER`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS insider_sell_count INTEGER`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS insider_summary TEXT`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS recent_insider_buy_summary TEXT`
      ,`ALTER TABLE public.ownership_snapshot ADD COLUMN IF NOT EXISTS recent_upgrade_summary TEXT`
    ];

    for (const statement of statements) {
      await queryWithTimeout(statement, [], {
        timeoutMs: 2500,
        label: 'research_cache.ensure_schema',
        maxRetries: 0,
        poolType: 'write',
      });
    }
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  return schemaReadyPromise;
}

async function readCompanyProfileCache(symbol) {
  await ensureResearchCacheSchema();
  const result = await safeQuery(
    `SELECT symbol, company_name, sector, industry, exchange, country, website, description, market_cap, beta, pe, insider_ownership_percent, updated_at
     FROM company_profiles
     WHERE symbol = $1
     LIMIT 1`,
    [symbol],
    {
      timeoutMs: 1000,
      label: 'research_cache.company_profile',
      maxRetries: 0,
    }
  );

  return result.rows?.[0] || null;
}

async function persistCompanyProfile(profile) {
  await ensureResearchCacheSchema();
  await queryWithTimeout(
    `INSERT INTO company_profiles (
       symbol, company_name, sector, industry, exchange, country, website, description, market_cap, beta, pe, insider_ownership_percent, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
     )
     ON CONFLICT (symbol) DO UPDATE SET
       company_name = COALESCE(EXCLUDED.company_name, company_profiles.company_name),
       sector = COALESCE(EXCLUDED.sector, company_profiles.sector),
       industry = COALESCE(EXCLUDED.industry, company_profiles.industry),
       exchange = COALESCE(EXCLUDED.exchange, company_profiles.exchange),
       country = COALESCE(EXCLUDED.country, company_profiles.country),
       website = COALESCE(EXCLUDED.website, company_profiles.website),
       description = COALESCE(EXCLUDED.description, company_profiles.description),
       market_cap = COALESCE(EXCLUDED.market_cap, company_profiles.market_cap),
       beta = COALESCE(EXCLUDED.beta, company_profiles.beta),
       pe = COALESCE(EXCLUDED.pe, company_profiles.pe),
       insider_ownership_percent = COALESCE(EXCLUDED.insider_ownership_percent, company_profiles.insider_ownership_percent),
       updated_at = NOW()`,
    [
      profile.symbol,
      profile.company_name,
      profile.sector,
      profile.industry,
      profile.exchange,
      profile.country,
      profile.website,
      profile.description,
      profile.market_cap,
      profile.beta,
      profile.pe,
      profile.insider_ownership_percent,
    ],
    {
      timeoutMs: 1500,
      label: 'research_cache.persist_company_profile',
      maxRetries: 0,
      poolType: 'write',
    }
  ).catch(() => null);
}

async function fetchCompanyProfileFromFmp(symbol) {
  const row = firstRow(await fmpFetch('/profile', { symbol }).catch(() => null));
  if (!row) {
    return {
      symbol,
      company_name: null,
      sector: null,
      industry: null,
      exchange: null,
      country: null,
      website: null,
      description: null,
      updated_at: null,
      source: 'empty',
    };
  }

  const normalized = {
    symbol,
    company_name: toStringValue(row.companyName || row.name),
    sector: toStringValue(row.sector),
    industry: toStringValue(row.industry),
    exchange: toStringValue(row.exchangeShortName || row.exchange),
    country: toStringValue(row.country),
    website: toStringValue(row.website),
    description: toStringValue(row.description),
    market_cap: toNumber(row.mktCap || row.marketCap),
    beta: toPositiveNumber(row.beta) ?? toNumber(row.beta),
    pe: toNumber(row.pe ?? row.peRatio ?? row.priceEarningsRatio),
    insider_ownership_percent: toNumber(row.heldPercentInsiders ?? row.insiderOwnership),
    updated_at: new Date().toISOString(),
    source: 'fmp',
  };

  await persistCompanyProfile(normalized);
  return normalized;
}

async function getCompanyProfile(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  const cached = await readCompanyProfileCache(symbol);
  const hasExtendedProfile = [cached?.beta, cached?.pe, cached?.insider_ownership_percent]
    .some((value) => value !== null && value !== undefined && Number(value) !== 0);
  const isComplete = Boolean(cached?.sector && cached?.industry && cached?.exchange && cached?.country && hasExtendedProfile);

  if (cached && isComplete && isFresh(cached.updated_at, PROFILE_TTL_MS)) {
    return {
      symbol,
      company_name: toStringValue(cached.company_name),
      sector: toStringValue(cached.sector),
      industry: toStringValue(cached.industry),
      exchange: toStringValue(cached.exchange),
      country: toStringValue(cached.country),
      website: toStringValue(cached.website),
      description: toStringValue(cached.description),
      market_cap: toNumber(cached.market_cap),
      beta: toNumber(cached.beta),
      pe: toNumber(cached.pe),
      insider_ownership_percent: toNumber(cached.insider_ownership_percent),
      updated_at: cached.updated_at || null,
      source: 'cache',
    };
  }

  const fresh = await fetchCompanyProfileFromFmp(symbol);
  if (fresh.source !== 'empty') {
    return fresh;
  }

  return {
    symbol,
    company_name: toStringValue(cached?.company_name),
    sector: toStringValue(cached?.sector),
    industry: toStringValue(cached?.industry),
    exchange: toStringValue(cached?.exchange),
    country: toStringValue(cached?.country),
    website: toStringValue(cached?.website),
    description: toStringValue(cached?.description),
    market_cap: toNumber(cached?.market_cap),
    beta: toNumber(cached?.beta),
    pe: toNumber(cached?.pe),
    insider_ownership_percent: toNumber(cached?.insider_ownership_percent),
    updated_at: cached?.updated_at || null,
    source: cached ? 'cache_stale' : 'empty',
  };
}

async function readPriceFromDb(symbol) {
  const result = await safeQuery(
    `SELECT
       COALESCE(q.symbol, m.symbol) AS symbol,
       COALESCE(q.price, m.price) AS price,
       COALESCE(q.change_percent, m.change_percent) AS change_percent,
       COALESCE(m.atr, NULL) AS atr,
       GREATEST(
         COALESCE(EXTRACT(EPOCH FROM q.updated_at)::bigint, 0),
         COALESCE(EXTRACT(EPOCH FROM m.updated_at)::bigint, 0),
         COALESCE(EXTRACT(EPOCH FROM m.last_updated)::bigint, 0)
       ) AS freshness_unix
     FROM market_quotes q
     FULL OUTER JOIN market_metrics m ON m.symbol = q.symbol
     WHERE COALESCE(q.symbol, m.symbol) = $1
     LIMIT 1`,
    [symbol],
    {
      timeoutMs: 2500,
      label: 'research_cache.price',
      maxRetries: 0,
    }
  );

  return result.rows?.[0] || null;
}

async function persistPriceCaches(priceRow, profile) {
  await queryWithTimeout(
    `INSERT INTO market_quotes (symbol, price, change_percent, sector, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (symbol) DO UPDATE SET
       price = COALESCE(EXCLUDED.price, market_quotes.price),
       change_percent = COALESCE(EXCLUDED.change_percent, market_quotes.change_percent),
       sector = COALESCE(EXCLUDED.sector, market_quotes.sector),
       updated_at = NOW()`,
    [priceRow.symbol, priceRow.price, priceRow.change_percent, profile?.sector || null],
    {
      timeoutMs: 1500,
      label: 'research_cache.persist_market_quotes',
      maxRetries: 0,
      poolType: 'write',
    }
  ).catch(() => null);

  await queryWithTimeout(
    `INSERT INTO market_metrics (symbol, price, change_percent, atr, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (symbol) DO UPDATE SET
       price = COALESCE(EXCLUDED.price, market_metrics.price),
       change_percent = COALESCE(EXCLUDED.change_percent, market_metrics.change_percent),
       atr = COALESCE(EXCLUDED.atr, market_metrics.atr),
       updated_at = NOW()`,
    [priceRow.symbol, priceRow.price, priceRow.change_percent, priceRow.atr],
    {
      timeoutMs: 1500,
      label: 'research_cache.persist_market_metrics',
      maxRetries: 0,
      poolType: 'write',
    }
  ).catch(() => null);
}

async function fetchDailyCandlesForAtr(symbol) {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 40);

  const payload = await fmpFetch('/historical-price-eod/light', {
    symbol,
    from: formatIsoDate(from),
    to: formatIsoDate(today),
  }).catch(() => null);

  const rows = Array.isArray(payload) ? payload : [];
  if (rows.length) {
    return rows;
  }

  return fmpFetch('/historical-chart/1day', { symbol }).catch(() => []);
}

async function fetchPriceFromFmp(symbol, profile) {
  const quote = firstRow(await fmpFetch('/quote', { symbol }).catch(() => null));
  const candles = await fetchDailyCandlesForAtr(symbol);
  const price = toNumber(quote?.price);
  const changePercent = toNumber(quote?.changesPercentage)
    ?? toNumber(quote?.changePercentage)
    ?? computePercentChange(price, quote?.previousClose);

  const normalized = {
    symbol,
    price,
    change_percent: changePercent,
    atr: computeAtrFromCandles(candles),
    updated_at: new Date().toISOString(),
    source: 'fmp',
  };

  await persistPriceCaches(normalized, profile);
  return normalized;
}

async function getPriceData(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  const cached = await readPriceFromDb(symbol);

  if (cached && cached.price != null) {
    const updatedAt = Number(cached.freshness_unix) > 0
      ? new Date(Number(cached.freshness_unix) * 1000).toISOString()
      : null;

    if (updatedAt && isFresh(updatedAt, getPriceTtlMs())) {
      return {
        symbol,
        price: toNumber(cached.price),
        change_percent: toNumber(cached.change_percent),
        atr: toNumber(cached.atr),
        updated_at: updatedAt,
        source: 'cache',
      };
    }
  }

  const profile = await getCompanyProfile(symbol);
  const fresh = await fetchPriceFromFmp(symbol, profile).catch(() => null);
  if (fresh) {
    return fresh;
  }

  return {
    symbol,
    price: toNumber(cached?.price),
    change_percent: toNumber(cached?.change_percent),
    atr: toNumber(cached?.atr),
    updated_at: cached?.freshness_unix ? new Date(Number(cached.freshness_unix) * 1000).toISOString() : null,
    source: cached ? 'cache_stale' : 'empty',
  };
}

async function readFundamentalsCache(symbol) {
  await ensureResearchCacheSchema();
  const result = await safeQuery(
    `SELECT symbol, revenue_growth, eps_growth, gross_margin, net_margin, free_cash_flow,
            pe, ps, pb, debt_to_equity, roe_percent, fcf_yield_percent, dividend_yield_percent,
            earnings_yield_percent, altman_z_score, piotroski_score, quarterly_trends_json, updated_at
     FROM fundamentals_snapshot
     WHERE symbol = $1
     LIMIT 1`,
    [symbol],
    {
      timeoutMs: 1000,
      label: 'research_cache.fundamentals',
      maxRetries: 0,
    }
  );

  return result.rows?.[0] || null;
}

async function persistFundamentals(symbol, fundamentals) {
  await ensureResearchCacheSchema();
  await queryWithTimeout(
    `INSERT INTO fundamentals_snapshot (
       symbol, revenue_growth, eps_growth, gross_margin, net_margin, free_cash_flow,
       pe, ps, pb, debt_to_equity, roe_percent, fcf_yield_percent, dividend_yield_percent,
       earnings_yield_percent, altman_z_score, piotroski_score, quarterly_trends_json, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17::jsonb, NOW()
     )
     ON CONFLICT (symbol) DO UPDATE SET
       revenue_growth = COALESCE(EXCLUDED.revenue_growth, fundamentals_snapshot.revenue_growth),
       eps_growth = COALESCE(EXCLUDED.eps_growth, fundamentals_snapshot.eps_growth),
       gross_margin = COALESCE(EXCLUDED.gross_margin, fundamentals_snapshot.gross_margin),
       net_margin = COALESCE(EXCLUDED.net_margin, fundamentals_snapshot.net_margin),
       free_cash_flow = COALESCE(EXCLUDED.free_cash_flow, fundamentals_snapshot.free_cash_flow),
       pe = COALESCE(EXCLUDED.pe, fundamentals_snapshot.pe),
       ps = COALESCE(EXCLUDED.ps, fundamentals_snapshot.ps),
       pb = COALESCE(EXCLUDED.pb, fundamentals_snapshot.pb),
       debt_to_equity = COALESCE(EXCLUDED.debt_to_equity, fundamentals_snapshot.debt_to_equity),
       roe_percent = COALESCE(EXCLUDED.roe_percent, fundamentals_snapshot.roe_percent),
       fcf_yield_percent = COALESCE(EXCLUDED.fcf_yield_percent, fundamentals_snapshot.fcf_yield_percent),
       dividend_yield_percent = COALESCE(EXCLUDED.dividend_yield_percent, fundamentals_snapshot.dividend_yield_percent),
       earnings_yield_percent = COALESCE(EXCLUDED.earnings_yield_percent, fundamentals_snapshot.earnings_yield_percent),
       altman_z_score = COALESCE(EXCLUDED.altman_z_score, fundamentals_snapshot.altman_z_score),
       piotroski_score = COALESCE(EXCLUDED.piotroski_score, fundamentals_snapshot.piotroski_score),
       quarterly_trends_json = COALESCE(EXCLUDED.quarterly_trends_json, fundamentals_snapshot.quarterly_trends_json),
       updated_at = NOW()`,
    [
      symbol,
      fundamentals.revenue_growth,
      fundamentals.eps_growth,
      fundamentals.gross_margin,
      fundamentals.net_margin,
      fundamentals.free_cash_flow,
      fundamentals.pe,
      fundamentals.ps,
      fundamentals.pb,
      fundamentals.debt_to_equity,
      fundamentals.roe_percent,
      fundamentals.fcf_yield_percent,
      fundamentals.dividend_yield_percent,
      fundamentals.earnings_yield_percent,
      fundamentals.altman_z_score,
      fundamentals.piotroski_score,
      JSON.stringify(fundamentals.trends || []),
    ],
    {
      timeoutMs: 1500,
      label: 'research_cache.persist_fundamentals',
      maxRetries: 0,
      poolType: 'write',
    }
  ).catch(() => null);
}

async function fetchFundamentalsFromFmp(symbol) {
  const [growth, income, cashflow, ratiosTtm, keyMetricsTtm, financialScores, profile] = await Promise.all([
    fmpFetch('/financial-growth', { symbol, limit: 1 }).catch(() => null),
    fmpFetch('/income-statement', { symbol, period: 'quarter', limit: 8 }).catch(() => null),
    fmpFetch('/cash-flow-statement', { symbol, limit: 1 }).catch(() => null),
    fmpFetch('/ratios-ttm', { symbol }).catch(() => null),
    fmpFetch('/key-metrics-ttm', { symbol }).catch(() => null),
    fmpFetch('/financial-scores', { symbol }).catch(() => null),
    fmpFetch('/profile', { symbol }).catch(() => null),
  ]);

  const growthRow = firstRow(growth) || {};
  const incomeRows = firstArray(income);
  const incomeRow = firstRow(incomeRows) || {};
  const cashflowRow = firstRow(cashflow) || {};
  const ratiosRow = firstRow(ratiosTtm) || {};
  const keyMetricsRow = firstRow(keyMetricsTtm) || {};
  const scoresRow = firstRow(financialScores) || {};
  const profileRow = firstRow(profile) || {};
  const revenue = toNumber(incomeRow.revenue);
  const grossProfit = toNumber(incomeRow.grossProfit);
  const netIncome = toNumber(incomeRow.netIncome);

  const fundamentals = {
    symbol,
    revenue_growth: toNumber(growthRow.revenueGrowth ?? growthRow.revenue_growth),
    eps_growth: toNumber(growthRow.epsGrowth ?? growthRow.epsgrowth ?? growthRow.eps_growth),
    gross_margin: toNumber(incomeRow.grossProfitRatio) ?? (revenue && grossProfit !== null ? Number(((grossProfit / revenue) * 100).toFixed(2)) : null),
    net_margin: toNumber(incomeRow.netIncomeRatio) ?? (revenue && netIncome !== null ? Number(((netIncome / revenue) * 100).toFixed(2)) : null),
    free_cash_flow: toNumber(cashflowRow.freeCashFlow ?? cashflowRow.free_cash_flow),
    pe: toNumber(ratiosRow.priceToEarningsRatioTTM ?? keyMetricsRow.peRatioTTM ?? profileRow.pe),
    ps: toNumber(ratiosRow.priceToSalesRatioTTM ?? keyMetricsRow.priceToSalesRatioTTM ?? profileRow.priceToSales),
    pb: toNumber(ratiosRow.priceToBookRatioTTM ?? keyMetricsRow.pbRatioTTM),
    debt_to_equity: toNumber(ratiosRow.debtToEquityRatioTTM ?? ratiosRow.debtToEquityRatio ?? keyMetricsRow.debtToEquity),
    roe_percent: toNumber(keyMetricsRow.returnOnEquityTTM ?? ratiosRow.returnOnEquityTTM),
    fcf_yield_percent: toNumber(keyMetricsRow.freeCashFlowYieldTTM ?? keyMetricsRow.fcfYieldTTM),
    dividend_yield_percent: toNumber(ratiosRow.dividendYieldTTM ?? profileRow.lastDiv),
    earnings_yield_percent: toNumber(keyMetricsRow.earningsYieldTTM),
    altman_z_score: toNumber(scoresRow.altmanZScore),
    piotroski_score: toNumber(scoresRow.piotroskiScore),
    trends: buildQuarterlyFundamentalTrends(incomeRows),
    updated_at: new Date().toISOString(),
    source: 'fmp',
  };

  await persistFundamentals(symbol, fundamentals);
  return fundamentals;
}

async function getFundamentals(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  const cached = await readFundamentalsCache(symbol);
  const trendRows = parseJsonValue(cached?.quarterly_trends_json, []);
  const hasCachedData = Boolean(
    cached && [
      cached.revenue_growth,
      cached.eps_growth,
      cached.gross_margin,
      cached.net_margin,
      cached.free_cash_flow,
      cached.pe,
      cached.ps,
      cached.debt_to_equity,
      cached.roe_percent,
      cached.fcf_yield_percent,
      cached.dividend_yield_percent,
    ]
      .some((value) => value !== null && value !== undefined)
  );
  const hasExpandedData = Boolean(
    cached && [
      cached.pe,
      cached.ps,
      cached.debt_to_equity,
      cached.roe_percent,
      cached.fcf_yield_percent,
      cached.dividend_yield_percent,
    ].some((value) => value !== null && value !== undefined && Number(value) !== 0)
  );
  const hasTrendData = Array.isArray(trendRows) && trendRows.length >= 4;

  if (hasCachedData && hasExpandedData && hasTrendData && isFresh(cached.updated_at, FUNDAMENTALS_TTL_MS)) {
    return {
      symbol,
      revenue_growth: toNumber(cached.revenue_growth),
      eps_growth: toNumber(cached.eps_growth),
      gross_margin: toNumber(cached.gross_margin),
      net_margin: toNumber(cached.net_margin),
      free_cash_flow: toNumber(cached.free_cash_flow),
      pe: toNumber(cached.pe),
      ps: toNumber(cached.ps),
      pb: toNumber(cached.pb),
      debt_to_equity: toNumber(cached.debt_to_equity),
      roe_percent: toNumber(cached.roe_percent),
      fcf_yield_percent: toNumber(cached.fcf_yield_percent),
      dividend_yield_percent: toNumber(cached.dividend_yield_percent),
      earnings_yield_percent: toNumber(cached.earnings_yield_percent),
      altman_z_score: toNumber(cached.altman_z_score),
      piotroski_score: toNumber(cached.piotroski_score),
      trends: trendRows,
      updated_at: cached.updated_at || null,
      source: 'cache',
    };
  }

  const fresh = await fetchFundamentalsFromFmp(symbol).catch(() => null);
  if (fresh) {
    return fresh;
  }

  return {
    symbol,
    revenue_growth: toNumber(cached?.revenue_growth),
    eps_growth: toNumber(cached?.eps_growth),
    gross_margin: toNumber(cached?.gross_margin),
    net_margin: toNumber(cached?.net_margin),
    free_cash_flow: toNumber(cached?.free_cash_flow),
    pe: toNumber(cached?.pe),
    ps: toNumber(cached?.ps),
    pb: toNumber(cached?.pb),
    debt_to_equity: toNumber(cached?.debt_to_equity),
    roe_percent: toNumber(cached?.roe_percent),
    fcf_yield_percent: toNumber(cached?.fcf_yield_percent),
    dividend_yield_percent: toNumber(cached?.dividend_yield_percent),
    earnings_yield_percent: toNumber(cached?.earnings_yield_percent),
    altman_z_score: toNumber(cached?.altman_z_score),
    piotroski_score: toNumber(cached?.piotroski_score),
    trends: parseJsonValue(cached?.quarterly_trends_json, []),
    updated_at: cached?.updated_at || null,
    source: cached ? 'cache_stale' : 'empty',
  };
}

async function readOwnershipCache(symbol) {
  await ensureResearchCacheSchema();
  const result = await safeQuery(
    `SELECT symbol, institutional_ownership_percent, insider_trend, etf_exposure,
            investors_holding, total_invested, new_positions, increased_positions,
            closed_positions, reduced_positions, put_call_ratio, etf_exposure_json,
            insider_total_bought, insider_total_sold, insider_buy_count, insider_sell_count,
            insider_summary, recent_insider_buy_summary, recent_upgrade_summary, updated_at
     FROM ownership_snapshot
     WHERE symbol = $1
     LIMIT 1`,
    [symbol],
    {
      timeoutMs: 1000,
      label: 'research_cache.ownership',
      maxRetries: 0,
    }
  );

  const row = result.rows?.[0] || null;
  if (!row) {
    return {
      symbol,
      institutional: null,
      insider: null,
      etf: null,
      updated_at: null,
      source: 'empty',
    };
  }

  return {
    symbol,
    institutional: toMeaningfulNumber(row.institutional_ownership_percent),
    insider: toStringValue(row.insider_trend),
    etf: toMeaningfulNumber(row.etf_exposure),
    investors_holding: toMeaningfulNumber(row.investors_holding),
    total_invested: toMeaningfulNumber(row.total_invested),
    new_positions: toMeaningfulNumber(row.new_positions),
    increased_positions: toMeaningfulNumber(row.increased_positions),
    closed_positions: toMeaningfulNumber(row.closed_positions),
    reduced_positions: toMeaningfulNumber(row.reduced_positions),
    put_call_ratio: toMeaningfulNumber(row.put_call_ratio),
    etf_exposure_list: parseJsonValue(row.etf_exposure_json, []),
    insider_total_bought: toMeaningfulNumber(row.insider_total_bought),
    insider_total_sold: toMeaningfulNumber(row.insider_total_sold),
    insider_buy_count: toMeaningfulNumber(row.insider_buy_count),
    insider_sell_count: toMeaningfulNumber(row.insider_sell_count),
    insider_summary: toStringValue(row.insider_summary),
    recent_insider_buy_summary: toStringValue(row.recent_insider_buy_summary),
    recent_upgrade_summary: toStringValue(row.recent_upgrade_summary),
    updated_at: row.updated_at || null,
    source: isFresh(row.updated_at, OWNERSHIP_TTL_MS) ? 'cache' : 'cache_stale',
  };
}

async function persistOwnership(symbol, ownership) {
  await ensureResearchCacheSchema();
  await queryWithTimeout(
    `INSERT INTO ownership_snapshot (
       symbol, institutional_ownership_percent, insider_trend, etf_exposure,
       investors_holding, total_invested, new_positions, increased_positions,
       closed_positions, reduced_positions, put_call_ratio, etf_exposure_json,
       insider_total_bought, insider_total_sold, insider_buy_count, insider_sell_count,
       insider_summary, recent_insider_buy_summary, recent_upgrade_summary, updated_at
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8,
       $9, $10, $11, $12::jsonb,
       $13, $14, $15, $16,
       $17, $18, $19, NOW()
     )
     ON CONFLICT (symbol) DO UPDATE SET
       institutional_ownership_percent = COALESCE(EXCLUDED.institutional_ownership_percent, ownership_snapshot.institutional_ownership_percent),
       insider_trend = COALESCE(EXCLUDED.insider_trend, ownership_snapshot.insider_trend),
       etf_exposure = COALESCE(EXCLUDED.etf_exposure, ownership_snapshot.etf_exposure),
       investors_holding = COALESCE(EXCLUDED.investors_holding, ownership_snapshot.investors_holding),
       total_invested = COALESCE(EXCLUDED.total_invested, ownership_snapshot.total_invested),
       new_positions = COALESCE(EXCLUDED.new_positions, ownership_snapshot.new_positions),
       increased_positions = COALESCE(EXCLUDED.increased_positions, ownership_snapshot.increased_positions),
       closed_positions = COALESCE(EXCLUDED.closed_positions, ownership_snapshot.closed_positions),
       reduced_positions = COALESCE(EXCLUDED.reduced_positions, ownership_snapshot.reduced_positions),
       put_call_ratio = COALESCE(EXCLUDED.put_call_ratio, ownership_snapshot.put_call_ratio),
       etf_exposure_json = COALESCE(EXCLUDED.etf_exposure_json, ownership_snapshot.etf_exposure_json),
       insider_total_bought = COALESCE(EXCLUDED.insider_total_bought, ownership_snapshot.insider_total_bought),
       insider_total_sold = COALESCE(EXCLUDED.insider_total_sold, ownership_snapshot.insider_total_sold),
       insider_buy_count = COALESCE(EXCLUDED.insider_buy_count, ownership_snapshot.insider_buy_count),
       insider_sell_count = COALESCE(EXCLUDED.insider_sell_count, ownership_snapshot.insider_sell_count),
       insider_summary = COALESCE(EXCLUDED.insider_summary, ownership_snapshot.insider_summary),
       recent_insider_buy_summary = COALESCE(EXCLUDED.recent_insider_buy_summary, ownership_snapshot.recent_insider_buy_summary),
       recent_upgrade_summary = COALESCE(EXCLUDED.recent_upgrade_summary, ownership_snapshot.recent_upgrade_summary),
       updated_at = NOW()`,
    [
      symbol,
      ownership.institutional,
      ownership.insider,
      ownership.etf,
      ownership.investors_holding,
      ownership.total_invested,
      ownership.new_positions,
      ownership.increased_positions,
      ownership.closed_positions,
      ownership.reduced_positions,
      ownership.put_call_ratio,
      JSON.stringify(ownership.etf_exposure_list || []),
      ownership.insider_total_bought,
      ownership.insider_total_sold,
      ownership.insider_buy_count,
      ownership.insider_sell_count,
      ownership.insider_summary,
      ownership.recent_insider_buy_summary,
      ownership.recent_upgrade_summary,
    ],
    {
      timeoutMs: 1500,
      label: 'research_cache.persist_ownership',
      maxRetries: 0,
      poolType: 'write',
    }
  ).catch(() => null);
}

async function fetchOwnershipFromFmp(symbol) {
  let institutionalSummary = null;
  for (const period of buildRecentQuarterSequence()) {
    institutionalSummary = await fmpFetch('/institutional-ownership/symbol-positions-summary', {
      symbol,
      year: period.year,
      quarter: period.quarter,
    }).catch(() => null);

    if (firstRow(institutionalSummary)) {
      break;
    }
  }

  const [insiderStats, insiderTrades, grades, etfExposure] = await Promise.all([
    fmpFetch('/insider-trading/statistics', { symbol }).catch(() => null),
    fmpFetch('/insider-trading/search', { symbol, limit: 10 }).catch(() => null),
    fmpFetch('/grades', { symbol, limit: 5 }).catch(() => null),
    fmpFetch('/etf/asset-exposure', { symbol }).catch(() => null),
  ]);

  const institutionalRow = firstRow(institutionalSummary) || {};
  const insiderStatsRow = firstRow(insiderStats) || {};
  const etfRows = firstArray(etfExposure)
    .map((row) => ({
      name: toStringValue(row.etfName || row.asset || row.name || row.symbol),
      weight_percent: toNumber(row.weightPercentage ?? row.weight ?? row.percentage),
    }))
    .filter((row) => row.name && row.weight_percent !== null)
    .sort((left, right) => Number(right.weight_percent) - Number(left.weight_percent));

  const totalBought = toNumber(insiderStatsRow.totalBought ?? insiderStatsRow.total_buy_value ?? insiderStatsRow.totalPurchaseValue);
  const totalSold = toNumber(insiderStatsRow.totalSold ?? insiderStatsRow.total_sell_value ?? insiderStatsRow.totalSaleValue);
  const ownership = {
    symbol,
    institutional: toNumber(
      institutionalRow.ownershipPercent
        ?? institutionalRow.institutionalOwnershipPercent
        ?? institutionalRow.ownership_percentage
        ?? institutionalRow.institutional_ownership_percent
    ),
    insider: buildInsiderTrend(totalBought, totalSold),
    etf: etfRows.length ? Number(etfRows.reduce((sum, row) => sum + Number(row.weight_percent || 0), 0).toFixed(2)) : null,
    investors_holding: toNumber(institutionalRow.investorsHolding ?? institutionalRow.investors_holding),
    total_invested: toNumber(institutionalRow.totalInvested ?? institutionalRow.total_invested),
    new_positions: toNumber(institutionalRow.newPositions ?? institutionalRow.new_positions),
    increased_positions: toNumber(institutionalRow.increasedPositions ?? institutionalRow.increased_positions),
    closed_positions: toNumber(institutionalRow.closedPositions ?? institutionalRow.closed_positions),
    reduced_positions: toNumber(institutionalRow.reducedPositions ?? institutionalRow.reduced_positions),
    put_call_ratio: toPositiveNumber(institutionalRow.putCallRatio ?? institutionalRow.put_call_ratio),
    etf_exposure_list: etfRows.slice(0, 5),
    insider_total_bought: totalBought,
    insider_total_sold: totalSold,
    insider_buy_count: toNumber(insiderStatsRow.buyTransactions ?? insiderStatsRow.buyCount ?? insiderStatsRow.totalBuyTransactions),
    insider_sell_count: toNumber(insiderStatsRow.sellTransactions ?? insiderStatsRow.sellCount ?? insiderStatsRow.totalSellTransactions),
    insider_summary: totalBought !== null || totalSold !== null
      ? `Bought ${formatMoneyCompact(totalBought) || '—'} vs sold ${formatMoneyCompact(totalSold) || '—'} over the recent filing window.`
      : null,
    recent_insider_buy_summary: buildRecentInsiderBuySummary(insiderTrades),
    recent_upgrade_summary: buildRecentUpgradeSummary(grades),
    updated_at: new Date().toISOString(),
    source: 'fmp',
  };

  await persistOwnership(symbol, ownership);
  return ownership;
}

async function getOwnership(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  const cached = await readOwnershipCache(symbol);
  const hasCachedData = Boolean(
    cached && [
      cached.institutional,
      cached.put_call_ratio,
      cached.recent_insider_buy_summary,
      cached.recent_upgrade_summary,
      cached.etf,
    ].some((value) => value !== null && value !== undefined)
  );

  if (hasCachedData && isFresh(cached.updated_at, OWNERSHIP_TTL_MS)) {
    return cached;
  }

  const fresh = await fetchOwnershipFromFmp(symbol).catch(() => null);
  if (fresh) {
    return fresh;
  }

  return cached;
}

async function persistEarningsEventRows(symbol, rows) {
  for (const row of rows) {
    const reportDate = String(row.date || '').slice(0, 10);
    if (!reportDate) {
      continue;
    }

    await queryWithTimeout(
      `INSERT INTO earnings_events (
         symbol, report_date, report_time, eps_actual, eps_estimate, rev_estimate, rev_actual,
         revenue_estimate, revenue_actual, expected_move_percent, source, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()
       )
       ON CONFLICT (symbol, report_date)
       DO UPDATE SET
         report_time = COALESCE(EXCLUDED.report_time, earnings_events.report_time),
         eps_actual = COALESCE(EXCLUDED.eps_actual, earnings_events.eps_actual),
         eps_estimate = COALESCE(EXCLUDED.eps_estimate, earnings_events.eps_estimate),
         rev_estimate = COALESCE(EXCLUDED.rev_estimate, earnings_events.rev_estimate, earnings_events.revenue_estimate),
         rev_actual = COALESCE(EXCLUDED.rev_actual, earnings_events.rev_actual, earnings_events.revenue_actual),
         revenue_estimate = COALESCE(EXCLUDED.revenue_estimate, earnings_events.revenue_estimate, earnings_events.rev_estimate),
         revenue_actual = COALESCE(EXCLUDED.revenue_actual, earnings_events.revenue_actual, earnings_events.rev_actual),
         expected_move_percent = COALESCE(EXCLUDED.expected_move_percent, earnings_events.expected_move_percent),
         source = COALESCE(EXCLUDED.source, earnings_events.source),
         updated_at = NOW()`,
      [
        symbol,
        reportDate,
        toStringValue(row.report_time) || 'TBD',
        toNumber(row.epsActual ?? row.eps_actual),
        toNumber(row.epsEstimated ?? row.eps_estimate),
        toNumber(row.revenueEstimate ?? row.revenue_estimate ?? row.rev_estimate),
        toNumber(row.revenueActual ?? row.revenue_actual ?? row.rev_actual),
        toNumber(row.revenueEstimate ?? row.revenue_estimate ?? row.rev_estimate),
        toNumber(row.revenueActual ?? row.revenue_actual ?? row.rev_actual),
        toPositiveNumber(row.expectedMove ?? row.expected_move_percent),
        toStringValue(row.source) || 'fmp_stable_earnings_calendar',
      ],
      {
        timeoutMs: 1500,
        label: 'research_cache.persist_earnings_events',
        maxRetries: 0,
        poolType: 'write',
      }
    ).catch(() => null);
  }
}

async function persistEarningsSnapshot(symbol, earnings) {
  await ensureResearchCacheSchema();
  await queryWithTimeout(
    `INSERT INTO earnings_snapshot (
       symbol, next_earnings_date, eps_estimate, expected_move_percent, last_surprise_percent, report_date, eps_actual, actual_move_percent, beat, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()
     )
     ON CONFLICT (symbol) DO UPDATE SET
       next_earnings_date = COALESCE(EXCLUDED.next_earnings_date, earnings_snapshot.next_earnings_date),
       eps_estimate = COALESCE(EXCLUDED.eps_estimate, earnings_snapshot.eps_estimate),
       expected_move_percent = COALESCE(EXCLUDED.expected_move_percent, earnings_snapshot.expected_move_percent),
       last_surprise_percent = COALESCE(EXCLUDED.last_surprise_percent, earnings_snapshot.last_surprise_percent),
       report_date = COALESCE(EXCLUDED.report_date, earnings_snapshot.report_date),
       eps_actual = COALESCE(EXCLUDED.eps_actual, earnings_snapshot.eps_actual),
       actual_move_percent = COALESCE(EXCLUDED.actual_move_percent, earnings_snapshot.actual_move_percent),
       beat = COALESCE(EXCLUDED.beat, earnings_snapshot.beat),
       updated_at = NOW()`,
    [
      symbol,
      earnings.next?.date || null,
      toNumber(earnings.next?.epsEstimated ?? earnings.next?.eps_estimate),
      toPositiveNumber(earnings.next?.expectedMove ?? earnings.next?.expected_move_percent),
      toNumber(earnings.history?.[0]?.surprisePercent ?? earnings.history?.[0]?.surprise_percent),
      earnings.history?.[0]?.date || null,
      toNumber(earnings.history?.[0]?.epsActual ?? earnings.history?.[0]?.eps_actual),
      toNumber(earnings.history?.[0]?.actualMove ?? earnings.history?.[0]?.actual_move_percent),
      typeof earnings.history?.[0]?.beat === 'boolean' ? earnings.history[0].beat : null,
    ],
    {
      timeoutMs: 1500,
      label: 'research_cache.persist_earnings_snapshot',
      maxRetries: 0,
      poolType: 'write',
    }
  ).catch(() => null);
}

async function readEarningsFromDb(symbol) {
  const result = await safeQuery(
    `WITH snapshot AS (
       SELECT updated_at
       FROM earnings_snapshot
       WHERE symbol = $1
       LIMIT 1
     ), history AS (
       SELECT
         e.report_date::text AS date,
         e.report_time,
         e.eps_actual,
         e.eps_estimate,
         e.revenue_estimate AS revenue_estimate,
         e.revenue_actual AS revenue_actual,
         COALESCE(e.eps_surprise_pct, CASE
           WHEN e.eps_actual IS NOT NULL AND e.eps_estimate IS NOT NULL AND e.eps_estimate <> 0
             THEN ((e.eps_actual - e.eps_estimate) / ABS(e.eps_estimate)) * 100
           ELSE NULL
         END) AS surprise_percent,
         COALESCE(
           r.implied_move_pct,
           e.expected_move_percent
         ) AS expected_move_percent,
         COALESCE(
           r.actual_move_pct,
           ABS(r.close_pct),
           CASE
             WHEN prev_day.close IS NOT NULL AND next_day.close IS NOT NULL AND prev_day.close <> 0
               THEN ((next_day.close - prev_day.close) / prev_day.close) * 100
             ELSE NULL
           END
         ) AS actual_move_percent,
         COALESCE(r.pre_market_gap_pct, r.open_gap_pct) AS pre_move_percent,
         CASE
           WHEN UPPER(COALESCE(e.report_time, '')) IN ('PM', 'AMC', 'AFTER CLOSE', 'AFTER MARKET CLOSE')
             THEN COALESCE(r.day2_followthrough_pct, r.close_pct, r.actual_move_pct)
           ELSE COALESCE(r.close_pct, r.actual_move_pct, r.day2_followthrough_pct)
         END AS post_move_percent,
         CASE
           WHEN UPPER(COALESCE(e.report_time, '')) IN ('AM', 'BMO', 'BEFORE OPEN', 'BEFORE MARKET OPEN') THEN 'SAME_DAY'
           WHEN UPPER(COALESCE(e.report_time, '')) IN ('PM', 'AMC', 'AFTER CLOSE', 'AFTER MARKET CLOSE') THEN 'NEXT_DAY'
           ELSE 'PRIMARY_SESSION'
         END AS true_reaction_window,
         prev_day.close AS pre_price,
         next_day.close AS post_price,
         day1_day.close AS day1_close,
         day3_day.close AS day3_close,
         COALESCE(e.source, 'db') AS source,
         COALESCE(e.updated_at, e.created_at, NOW()) AS updated_at
      FROM earnings_history e
       LEFT JOIN earnings_market_reaction r
         ON r.symbol = e.symbol
        AND r.report_date = e.report_date
       LEFT JOIN LATERAL (
         SELECT close
         FROM daily_ohlc d
         WHERE d.symbol = e.symbol
           AND d.date < e.report_date
         ORDER BY d.date DESC
         LIMIT 1
       ) prev_day ON TRUE
       LEFT JOIN LATERAL (
         SELECT close
         FROM daily_ohlc d
         WHERE d.symbol = e.symbol
           AND d.date >= e.report_date
         ORDER BY d.date ASC
         LIMIT 1
       ) next_day ON TRUE
       LEFT JOIN LATERAL (
         SELECT close
         FROM daily_ohlc d
         WHERE d.symbol = e.symbol
           AND next_day.close IS NOT NULL
           AND d.date > e.report_date
         ORDER BY d.date ASC
         LIMIT 1
       ) day1_day ON TRUE
       LEFT JOIN LATERAL (
         SELECT close
         FROM daily_ohlc d
         WHERE d.symbol = e.symbol
           AND next_day.close IS NOT NULL
           AND d.date > e.report_date
         ORDER BY d.date ASC
         OFFSET 2
         LIMIT 1
       ) day3_day ON TRUE
       WHERE e.symbol = $1
         AND e.report_date <= CURRENT_DATE
       ORDER BY e.report_date DESC
      LIMIT 12
     ), next_event AS (
       SELECT *
       FROM (
         SELECT
           e.report_date::text AS date,
           COALESCE(NULLIF(e.report_time, ''), 'TBD') AS report_time,
           e.eps_actual,
           e.eps_estimate,
           COALESCE(e.revenue_estimate, e.rev_estimate) AS revenue_estimate,
           COALESCE(e.revenue_actual, e.rev_actual) AS revenue_actual,
           COALESCE(
             e.expected_move_percent,
             CASE
               WHEN e.atr IS NOT NULL AND e.price IS NOT NULL AND e.price <> 0 THEN (e.atr / e.price) * 100
               ELSE NULL
             END
           ) AS expected_move_percent,
           COALESCE(e.source, 'db') AS source,
           COALESCE(e.updated_at, e.created_at, NOW()) AS updated_at,
           0 AS source_rank
         FROM earnings_events e
         WHERE e.symbol = $1
           AND e.report_date >= CURRENT_DATE

         UNION ALL

         SELECT
           s.next_earnings_date::text AS date,
           'TBD' AS report_time,
           s.eps_actual,
           s.eps_estimate,
           NULL::numeric AS revenue_estimate,
           NULL::numeric AS revenue_actual,
           s.expected_move_percent,
           'snapshot' AS source,
           s.updated_at,
           1 AS source_rank
         FROM earnings_snapshot s
         WHERE s.symbol = $1
           AND s.next_earnings_date >= CURRENT_DATE
       ) next_candidates
       ORDER BY source_rank ASC, date ASC
       LIMIT 1
     )
     SELECT json_build_object(
       'history', COALESCE((SELECT json_agg(h ORDER BY h.date DESC) FROM history h), '[]'::json),
       'next', (SELECT row_to_json(n) FROM next_event n),
       'updated_at', GREATEST(
         COALESCE((SELECT MAX(updated_at) FROM snapshot), NOW() - INTERVAL '100 years'),
         COALESCE((SELECT MAX(updated_at) FROM history), NOW() - INTERVAL '100 years'),
         COALESCE((SELECT MAX(updated_at) FROM next_event), NOW() - INTERVAL '100 years')
       )
     ) AS payload`,
    [symbol],
    {
      timeoutMs: 1200,
      label: 'research_cache.earnings',
      maxRetries: 0,
    }
  );

  return result.rows?.[0]?.payload || null;
}

function normalizeEarningsRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    date: String(row?.date || '').slice(0, 10),
    report_time: toDisplayTime(row?.report_time),
    eps_actual: toNumber(row?.eps_actual ?? row?.epsActual),
    eps_estimate: toNumber(row?.eps_estimate ?? row?.epsEstimated),
    revenue_estimate: toNumber(row?.revenue_estimate ?? row?.revenueEstimate ?? row?.rev_estimate),
    revenue_actual: toNumber(row?.revenue_actual ?? row?.revenueActual ?? row?.rev_actual),
    surprise_percent: toNumber(row?.surprise_percent ?? row?.surprisePercent),
    expected_move_percent: toPositiveNumber(row?.expected_move_percent ?? row?.expectedMove),
    pre_move_percent: toNumber(row?.pre_move_percent ?? row?.preMovePercent),
    post_move_percent: toNumber(row?.post_move_percent ?? row?.postMovePercent),
    actual_move_percent: toNumber(row?.actual_move_percent ?? row?.actualMove),
    true_reaction_window: toStringValue(row?.true_reaction_window ?? row?.trueReactionWindow),
    pre_price: toNumber(row?.pre_price ?? row?.prePrice),
    post_price: toNumber(row?.post_price ?? row?.postPrice),
    day1_close: toNumber(row?.day1_close ?? row?.day1Close),
    day3_close: toNumber(row?.day3_close ?? row?.day3Close),
    source: toStringValue(row?.source),
    updated_at: row?.updated_at || null,
  }));
}

async function fetchEarningsFromFmp(symbol, priceData) {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 450);
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + 365);

  const rows = await fmpFetch('/earnings-calendar', {
    from: formatIsoDate(from),
    to: formatIsoDate(to),
  }).catch(() => []);

  const filtered = (Array.isArray(rows) ? rows : [])
    .filter((row) => normalizeSymbol(row?.symbol) === symbol)
    .sort((left, right) => Date.parse(String(right?.date || '')) - Date.parse(String(left?.date || '')));

  const impliedMove = priceData?.atr && priceData?.price
    ? Number(((priceData.atr / priceData.price) * 100).toFixed(2))
    : null;

  const history = filtered
    .filter((row) => Date.parse(String(row?.date || '')) <= Date.now())
    .slice(0, 12)
    .map((row) => ({
      date: String(row.date || '').slice(0, 10),
      report_time: toDisplayTime(row.time),
      eps_actual: toNumber(row.epsActual ?? row.eps),
      eps_estimate: toNumber(row.epsEstimated),
      surprise_percent: (() => {
        const actual = toNumber(row.epsActual ?? row.eps);
        const estimate = toNumber(row.epsEstimated);
        if (actual === null || estimate === null || estimate === 0) {
          return null;
        }
        return Number((((actual - estimate) / Math.abs(estimate)) * 100).toFixed(2));
      })(),
      expected_move_percent: impliedMove,
      pre_move_percent: null,
      post_move_percent: null,
      actual_move_percent: null,
      true_reaction_window: normalizeReportTime(row.time) === 'PM' ? 'NEXT_DAY' : normalizeReportTime(row.time) === 'AM' ? 'SAME_DAY' : 'PRIMARY_SESSION',
      pre_price: null,
      post_price: null,
      updated_at: new Date().toISOString(),
    }));

  const next = filtered
    .filter((row) => Date.parse(String(row?.date || '')) >= Date.now())
    .slice(0, 1)
    .map((row) => ({
      date: String(row.date || '').slice(0, 10),
      report_time: toDisplayTime(row.time),
      eps_actual: toNumber(row.epsActual ?? row.eps),
      eps_estimate: toNumber(row.epsEstimated),
      expected_move_percent: impliedMove,
      updated_at: new Date().toISOString(),
    }))[0] || null;

  const normalized = {
    symbol,
    next,
    history,
    updated_at: new Date().toISOString(),
    source: 'fmp',
  };

  await persistEarningsEventRows(symbol, [...history, ...(next ? [next] : [])]);
  await persistEarningsSnapshot(symbol, normalized);
  return normalized;
}

async function getEarnings(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  const cached = await readEarningsFromDb(symbol);
  let derivedExpectedPercent = null;

  async function ensureDerivedExpectedPercent() {
    if (derivedExpectedPercent !== null) {
      return derivedExpectedPercent;
    }

    const priceData = await getPriceData(symbol).catch(() => null);
    derivedExpectedPercent = priceData?.atr && priceData?.price
      ? Number(((priceData.atr / priceData.price) * 100).toFixed(2))
      : null;

    return derivedExpectedPercent;
  }

  const history = normalizeEarningsRows(cached?.history);

  const next = cached?.next
    ? {
        date: String(cached.next.date || '').slice(0, 10),
        report_time: toDisplayTime(cached.next.report_time) || 'TBD',
        eps_actual: toNumber(cached.next.eps_actual ?? cached.next.epsActual),
        eps_estimate: toNumber(cached.next.eps_estimate ?? cached.next.epsEstimated),
        revenue_estimate: toNumber(cached.next.revenue_estimate ?? cached.next.revenueEstimate ?? cached.next.rev_estimate),
        revenue_actual: toNumber(cached.next.revenue_actual ?? cached.next.revenueActual ?? cached.next.rev_actual),
        expected_move_percent: toPositiveNumber(cached.next.expected_move_percent ?? cached.next.expectedMove),
        source: toStringValue(cached.next.source) || toStringValue(cached.source) || 'db',
        updated_at: cached.next.updated_at || cached.updated_at || null,
      }
    : null;

  const cachedStatus = classifyUpcomingStatus(next);
  const hasFreshDb = Boolean((history.length > 0 || next) && isFresh(cached?.updated_at, EARNINGS_FRESH_TTL_MS));
  const hasFreshUpcomingEvent = Boolean(next && hasFreshDb);

  if ((history.length > 0 || next) && isFresh(cached?.updated_at, EARNINGS_TTL_MS) && hasFreshUpcomingEvent) {
    return {
      symbol,
      next,
      history,
      updated_at: cached.updated_at || null,
      source: 'cache',
      status: cachedStatus,
      read: buildUpcomingRead(cachedStatus, next),
    };
  }

  const derivedMove = await ensureDerivedExpectedPercent();
  const normalizedHistory = history.map((row) => ({
    ...row,
    expected_move_percent: row.expected_move_percent ?? derivedMove,
  }));
  const normalizedNext = next
    ? {
        ...next,
        expected_move_percent: mergeExpectedMove(next, derivedMove),
      }
    : null;

  const fetchedNextRaw = await fetchNextEventForSymbol(symbol).catch(() => null);
  const fetchedNext = fetchedNextRaw
    ? {
        date: String(fetchedNextRaw.date || '').slice(0, 10),
        report_time: toDisplayTime(fetchedNextRaw.report_time) || 'TBD',
        eps_actual: toNumber(fetchedNextRaw.eps_actual ?? fetchedNextRaw.epsActual),
        eps_estimate: toNumber(fetchedNextRaw.eps_estimate ?? fetchedNextRaw.epsEstimated),
        revenue_estimate: toNumber(fetchedNextRaw.revenue_estimate ?? fetchedNextRaw.revenueEstimate ?? fetchedNextRaw.rev_estimate),
        revenue_actual: toNumber(fetchedNextRaw.revenue_actual ?? fetchedNextRaw.revenueActual ?? fetchedNextRaw.rev_actual),
        expected_move_percent: mergeExpectedMove(fetchedNextRaw, derivedMove),
        source: toStringValue(fetchedNextRaw.source) || 'fmp',
        updated_at: fetchedNextRaw.updated_at || new Date().toISOString(),
      }
    : null;

  if (fetchedNext) {
    await persistEarningsEventRows(symbol, [fetchedNext]);
  }

  const fallbackNext = fetchedNext || normalizedNext || null;
  const fallbackSource = fetchedNext ? 'fmp' : (next ? 'fallback' : 'none');
  const fallbackStatus = classifyUpcomingStatus(fallbackNext);

  if (normalizedHistory.length > 0 || fallbackNext) {
    return {
      symbol,
      next: fallbackNext,
      history: normalizedHistory,
      updated_at: fallbackNext?.updated_at || cached?.updated_at || null,
      source: fallbackSource,
      status: fallbackStatus,
      read: buildUpcomingRead(fallbackStatus, fallbackNext),
    };
  }

  return {
    symbol,
    next: null,
    history: normalizedHistory,
    updated_at: cached?.updated_at || null,
    source: 'none',
    status: 'none',
    read: buildUpcomingRead('none', null),
  };
}

function classifyTrend(changePercent) {
  const numeric = toNumber(changePercent);
  if (numeric === null) return 'neutral';
  if (numeric >= 0.35) return 'bullish';
  if (numeric <= -0.35) return 'bearish';
  return 'neutral';
}

function classifyRegime(spyChange, qqqChange, vixPrice) {
  const vix = toNumber(vixPrice);
  if (vix !== null && vix >= 25) return 'risk_off';
  if ((toNumber(spyChange) || 0) > 0 && (toNumber(qqqChange) || 0) > 0 && (vix === null || vix < 18)) {
    return 'risk_on';
  }
  return 'balanced';
}

function classifyRegimeFromContext(spyTrend, qqqTrend, vixPrice) {
  const vix = toNumber(vixPrice);
  if (vix !== null && vix >= 25) {
    return 'risk_off';
  }

  if (String(spyTrend || 'neutral') === 'bullish' && String(qqqTrend || 'neutral') === 'bullish' && (vix === null || vix < 18)) {
    return 'risk_on';
  }

  return 'balanced';
}

async function readSectorStrength() {
  const result = await safeQuery(
    `SELECT
       COALESCE(NULLIF(TRIM(tu.sector), ''), NULLIF(TRIM(mq.sector), '')) AS sector,
       AVG(mm.change_percent) AS relative_strength
     FROM market_metrics mm
     LEFT JOIN ticker_universe tu ON tu.symbol = mm.symbol
     LEFT JOIN market_quotes mq ON mq.symbol = mm.symbol
     WHERE COALESCE(NULLIF(TRIM(tu.sector), ''), NULLIF(TRIM(mq.sector), '')) IS NOT NULL
       AND mm.updated_at > NOW() - INTERVAL '1 day'
     GROUP BY COALESCE(NULLIF(TRIM(tu.sector), ''), NULLIF(TRIM(mq.sector), ''))
     ORDER BY AVG(mm.change_percent) DESC`,
    [],
    {
      timeoutMs: 1000,
      label: 'research_cache.sector_strength',
      maxRetries: 0,
    }
  );

  const bucketed = new Map();

  for (const row of result.rows || []) {
    const bucket = normalizeSectorGroup(row.sector) || toStringValue(row.sector);
    if (!bucket) {
      continue;
    }

    const current = bucketed.get(bucket) || { total: 0, count: 0 };
    current.total += Number(toNumber(row.relative_strength) || 0);
    current.count += 1;
    bucketed.set(bucket, current);
  }

  for (const sector of DEFAULT_SECTOR_GROUPS) {
    if (!bucketed.has(sector)) {
      bucketed.set(sector, { total: 0, count: 0 });
    }
  }

  const ordered = Array.from(bucketed.entries())
    .map(([sector, stats]) => ({
      sector,
      change: Number(((stats.count ? stats.total / stats.count : 0)).toFixed(2)),
    }))
    .sort((left, right) => right.change - left.change);

  return {
    map: Object.fromEntries(ordered.map((row) => [row.sector, row.change])),
    leaders: ordered.slice(0, 3),
    laggers: [...ordered].sort((left, right) => left.change - right.change).slice(0, 3),
  };
}

function normalizeSectorStrengthPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { map: {}, leaders: [], laggers: [] };
  }

  if (payload.map || payload.leaders || payload.laggers) {
    const merged = { ...(payload.map || {}) };

    for (const sector of DEFAULT_SECTOR_GROUPS) {
      if (merged[sector] == null) {
        merged[sector] = 0;
      }
    }

    const ordered = Object.entries(merged)
      .filter(([, value]) => typeof value === 'number')
      .map(([sector, change]) => ({ sector, change: Number(change) }))
      .sort((left, right) => Number(right.change) - Number(left.change));

    return {
      map: merged,
      leaders: ordered.slice(0, 3),
      laggers: [...ordered].sort((left, right) => Number(left.change) - Number(right.change)).slice(0, 3),
    };
  }

  const merged = { ...payload };
  for (const sector of DEFAULT_SECTOR_GROUPS) {
    if (merged[sector] == null) {
      merged[sector] = 0;
    }
  }

  const ordered = Object.entries(merged)
    .filter(([, value]) => typeof value === 'number')
    .map(([sector, change]) => ({ sector, change: Number(change) }))
    .sort((left, right) => Number(right.change) - Number(left.change));

  return {
    map: merged,
    leaders: ordered.slice(0, 3),
    laggers: [...ordered].sort((left, right) => Number(left.change) - Number(right.change)).slice(0, 3),
  };
}

async function readCachedMarketContext() {
  await ensureResearchCacheSchema();
  const result = await safeQuery(
    `SELECT id, spy_trend, qqq_trend, vix_level, sector_strength_json, updated_at
     FROM macro_snapshot
     WHERE id = 'global'
     LIMIT 1`,
    [],
    {
      timeoutMs: 1000,
      label: 'research_cache.market_context',
      maxRetries: 0,
    }
  );

  return result.rows?.[0] || null;
}

async function persistMarketContext(context) {
  await ensureResearchCacheSchema();
  await queryWithTimeout(
    `INSERT INTO macro_snapshot (
       id, spy_trend, qqq_trend, vix_level, sector_strength_json, updated_at
     ) VALUES (
       'global', $1, $2, $3, $4::jsonb, NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       spy_trend = EXCLUDED.spy_trend,
       qqq_trend = EXCLUDED.qqq_trend,
       vix_level = EXCLUDED.vix_level,
       sector_strength_json = EXCLUDED.sector_strength_json,
       updated_at = NOW()`,
    [
      context.spy_trend,
      context.qqq_trend,
      context.vix_level,
      JSON.stringify(context.sector_strength_json || {}),
    ],
    {
      timeoutMs: 1500,
      label: 'research_cache.persist_market_context',
      maxRetries: 0,
      poolType: 'write',
    }
  ).catch(() => null);
}

async function readCachedNarrative(regime) {
  await ensureResearchCacheSchema();
  const result = await safeQuery(
    `SELECT narrative, created_at
     FROM market_narratives
     WHERE regime = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [regime],
    {
      timeoutMs: 1000,
      label: 'research_cache.market_narrative',
      maxRetries: 0,
    }
  );

  const row = result.rows?.[0] || null;
  if (!row) {
    return null;
  }

  return row.narrative || null;
}

async function persistNarrative(regime, narrative) {
  await ensureResearchCacheSchema();
  await queryWithTimeout(
    `INSERT INTO market_narratives (regime, narrative, created_at)
     VALUES ($1, $2, NOW())`,
    [regime, narrative],
    {
      timeoutMs: 1500,
      label: 'research_cache.persist_market_narrative',
      maxRetries: 0,
      poolType: 'write',
    }
  ).catch(() => null);
}

async function getMarketContext() {
  await ensureResearchCacheSchema();
  const cached = await readCachedMarketContext();
  const ttlMs = getMarketContextTtlMs();

  const buildCachedContext = async (sourceLabel, stale = false) => {
    const sectorStrength = normalizeSectorStrengthPayload(cached.sector_strength_json);
    const cachedRegime = classifyRegimeFromContext(cached?.spy_trend, cached?.qqq_trend, cached?.vix_level);
    const cachedNarrative = await readCachedNarrative(cachedRegime);

    return {
      spy_trend: cached?.spy_trend || 'neutral',
      qqq_trend: cached?.qqq_trend || 'neutral',
      vix_level: toNumber(cached?.vix_level),
      spy: { price: null, change: null },
      qqq: { price: null, change: null },
      vix: { level: toNumber(cached?.vix_level) },
      regime: cachedRegime,
      regimeBias: getRegimeBias(cachedRegime),
      sectorTailwind: false,
      sector_strength_json: sectorStrength.map,
      sectorLeaders: sectorStrength.leaders,
      sectorLaggers: sectorStrength.laggers,
      narrative: cachedNarrative || null,
      updated_at: cached?.updated_at || null,
      lastUpdated: cached?.updated_at || null,
      stale,
      source: sourceLabel,
    };
  };

  if (cached && isFresh(cached.updated_at, ttlMs) && toNumber(cached.vix_level) !== null && Number(cached.vix_level) > 0) {
    return buildCachedContext('cache', false);
  }

  try {
    const [spy, qqq, vix, sectorStrength] = await Promise.all([
      getPriceData('SPY'),
      getPriceData('QQQ'),
      getVolatilityProxyPriceData(),
      readSectorStrength(),
    ]);
    const regime = getMarketRegime({
      spy: spy?.change_percent,
      qqq: qqq?.change_percent,
      vix: vix?.price,
    });

    const context = {
      spy_trend: classifyTrend(spy?.change_percent),
      qqq_trend: classifyTrend(qqq?.change_percent),
      vix_level: toNumber(vix?.price),
      spy: { price: toNumber(spy?.price), change: toNumber(spy?.change_percent) },
      qqq: { price: toNumber(qqq?.price), change: toNumber(qqq?.change_percent) },
      vix: { level: toNumber(vix?.price) },
      regime,
      regimeBias: getRegimeBias(regime),
      sectorTailwind: false,
      sector_strength_json: sectorStrength.map,
      sectorLeaders: sectorStrength.leaders,
      sectorLaggers: sectorStrength.laggers,
      updated_at: new Date().toISOString(),
    };

    const narrativeRegime = context.regime;
    let narrative = await readCachedNarrative(narrativeRegime);
    if (!narrative) {
      narrative = await generateNarrative({
        spy: spy?.change_percent,
        qqq: qqq?.change_percent,
        vix: vix?.price,
        regime: context.regime,
        sectorLeaders: context.sectorLeaders,
        sectorLaggers: context.sectorLaggers,
      });
      if (narrative) {
        await persistNarrative(narrativeRegime, narrative);
      }
    }

    await persistMarketContext(context);

    return {
      ...context,
      narrative: narrative || null,
      lastUpdated: context.updated_at,
      stale: false,
      source: 'live',
    };
  } catch (error) {
    if (cached) {
      return buildCachedContext('cache_stale', true);
    }

    throw error;
  }
}

function deriveMeta(parts, startedAt) {
  const updatedAt = parts
    .map((part) => parseTimestamp(part?.updated_at))
    .filter((value) => value !== null)
    .sort((left, right) => Number(right) - Number(left))[0];
  const sources = parts.map((part) => String(part?.source || 'empty'));

  return {
    source: sources.join(','),
    cached: sources.every((source) => source === 'cache'),
    stale: sources.some((source) => source.includes('stale') || source === 'empty'),
    updated_at: updatedAt ? new Date(updatedAt).toISOString() : null,
    total_ms: Date.now() - startedAt,
  };
}

async function getResearchTerminalPayload(symbolInput) {
  const startedAt = Date.now();
  const symbol = normalizeSymbol(symbolInput);

  await ensureResearchCacheSchema();

  const [profile, price, fundamentals, earningsRaw, ownership, context] = await Promise.all([
    getCompanyProfile(symbol),
    getPriceData(symbol),
    getFundamentals(symbol),
    getEarnings(symbol),
    getOwnership(symbol),
    getMarketContext(),
  ]);

  const earningsHistory = normalizeEarningsRows(earningsRaw.history);
  const normalizedEarnings = {
    symbol,
    next: earningsRaw.next
      ? {
          date: earningsRaw.next.date,
          report_time: toDisplayTime(earningsRaw.next.report_time) || null,
          eps_actual: earningsRaw.next.eps_actual ?? null,
          eps_estimate: earningsRaw.next.eps_estimate ?? null,
          revenue_estimate: earningsRaw.next.revenue_estimate ?? null,
          revenue_actual: earningsRaw.next.revenue_actual ?? null,
          expected_move_percent: earningsRaw.next.expected_move_percent ?? null,
          pre_move_percent: earningsRaw.next.pre_move_percent ?? null,
          post_move_percent: earningsRaw.next.post_move_percent ?? null,
          actual_move_percent: earningsRaw.next.actual_move_percent ?? null,
          true_reaction_window: earningsRaw.next.true_reaction_window ?? null,
        }
      : null,
    history: earningsHistory,
    updated_at: earningsRaw.updated_at || null,
    source: earningsRaw.source,
    status: earningsRaw.status || classifyUpcomingStatus(earningsRaw.next),
    read: earningsRaw.read || buildUpcomingRead(classifyUpcomingStatus(earningsRaw.next), earningsRaw.next),
  };

  const normalizedProfile = {
    ...profile,
    beta: toPositiveNumber(profile?.beta) ?? null,
    pe: toNumber(profile?.pe) && Number(profile.pe) !== 0
      ? toNumber(profile.pe)
      : toNumber(fundamentals?.pe),
    insider_ownership_percent: toNumber(profile?.insider_ownership_percent) && Number(profile.insider_ownership_percent) !== 0
      ? toNumber(profile.insider_ownership_percent)
      : null,
  };

  return {
    profile: normalizedProfile,
    price,
    fundamentals,
    earnings: normalizedEarnings,
    ownership,
    context: {
      ...context,
      sectorTailwind: hasSectorTailwind(normalizedProfile?.sector, context?.sectorLeaders),
      lastUpdated: context?.lastUpdated || context?.updated_at || null,
    },
    meta: deriveMeta([normalizedProfile, price, fundamentals, normalizedEarnings, ownership, context], startedAt),
  };
}

module.exports = {
  ensureResearchCacheSchema,
  getCompanyProfile,
  getPriceData,
  getFundamentals,
  getEarnings,
  getOwnership,
  getMarketContext,
  getResearchTerminalPayload,
  normalizeSymbol,
};