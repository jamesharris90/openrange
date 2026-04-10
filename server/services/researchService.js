const axios = require('axios');

const { queryWithTimeout } = require('../db/pg');
const { supabaseAdmin } = require('./supabaseClient');

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_API_KEY = process.env.FMP_API_KEY || '';
const RESEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MACRO_CACHE_TTL_MS = 30 * 60 * 1000;
const FMP_TIMEOUT_MS = 2500;
const MACRO_ROW_ID = 'global';

const refreshInFlight = new Map();

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toNullableString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toPercent(value) {
  const numeric = toNullableNumber(value);
  if (numeric === null) {
    return null;
  }

  if (Math.abs(numeric) <= 1) {
    return Number((numeric * 100).toFixed(2));
  }

  return Number(numeric.toFixed(2));
}

function toIsoString(value) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isMissingTableError(error) {
  return Boolean(error?.message && error.message.includes('Could not find the table'));
}

function pickFirstNumber(source, keys) {
  for (const key of keys) {
    const numeric = toNullableNumber(source?.[key]);
    if (numeric !== null) {
      return numeric;
    }
  }

  return null;
}

function pickFirstString(source, keys) {
  for (const key of keys) {
    const text = toNullableString(source?.[key]);
    if (text) {
      return text;
    }
  }

  return null;
}

function firstRow(payload) {
  if (Array.isArray(payload)) {
    return payload[0] || null;
  }

  if (payload && typeof payload === 'object') {
    return payload;
  }

  return null;
}

function buildChangePercent(profile) {
  const direct = toPercent(
    profile?.changesPercentage
    ?? profile?.changePercentage
    ?? profile?.change_percent
  );
  if (direct !== null) {
    return direct;
  }

  const price = toNullableNumber(profile?.price);
  const change = toNullableNumber(profile?.changes ?? profile?.change);
  if (price === null || change === null || price === change) {
    return null;
  }

  const previousClose = price - change;
  if (!previousClose) {
    return null;
  }

  return Number((((price - previousClose) / previousClose) * 100).toFixed(2));
}

function normalizeOverview(symbol, profile) {
  const row = profile || {};
  return {
    symbol,
    price: toNullableNumber(row.price),
    change_percent: buildChangePercent(row),
    sector: pickFirstString(row, ['sector']),
    industry: pickFirstString(row, ['industry']),
    exchange: pickFirstString(row, ['exchangeShortName', 'exchange']),
    country: pickFirstString(row, ['country']),
  };
}

function normalizeFundamentals(growth, income, balance, cashflow, dcf) {
  const growthRow = growth || {};
  const incomeRow = income || {};
  const balanceRow = balance || {};
  const cashflowRow = cashflow || {};
  const dcfRow = dcf || {};

  const revenue = pickFirstNumber(incomeRow, ['revenue']);
  const grossProfit = pickFirstNumber(incomeRow, ['grossProfit']);
  const netIncome = pickFirstNumber(incomeRow, ['netIncome']);
  const grossMargin = toPercent(
    incomeRow.grossProfitRatio
    ?? incomeRow.grossMargin
    ?? (revenue && grossProfit !== null ? grossProfit / revenue : null)
  );
  const netMargin = toPercent(
    incomeRow.netIncomeRatio
    ?? incomeRow.netMargin
    ?? (revenue && netIncome !== null ? netIncome / revenue : null)
  );
  const totalDebt = pickFirstNumber(balanceRow, ['totalDebt']);
  const totalEquity = pickFirstNumber(balanceRow, ['totalStockholdersEquity', 'totalEquity']);

  return {
    revenue_growth: toPercent(growthRow.revenueGrowth ?? growthRow.revenue_growth),
    eps_growth: toPercent(growthRow.epsgrowth ?? growthRow.epsGrowth ?? growthRow.eps_growth),
    gross_margin: grossMargin,
    net_margin: netMargin,
    free_cash_flow: pickFirstNumber(cashflowRow, ['freeCashFlow', 'free_cash_flow']),
    debt_to_equity: totalDebt !== null && totalEquity ? Number((totalDebt / totalEquity).toFixed(4)) : toNullableNumber(balanceRow.debtToEquity),
    dcf_value: pickFirstNumber(dcfRow, ['dcf', 'dcfValue']),
  };
}

function normalizeOwnership(profile, estimates) {
  const profileRow = profile || {};
  const estimatesRow = estimates || {};

  const institutional = toPercent(
    profileRow.institutionalOwnership
    ?? profileRow.institutionalOwnershipPercent
    ?? estimatesRow.institutionalOwnership
  );

  const insiderNet = pickFirstNumber(profileRow, ['insiderOwnership', 'insiderOwnershipPercent']);
  let insiderTrend = 'neutral';
  if (insiderNet !== null) {
    if (insiderNet > 0.5) {
      insiderTrend = 'buy';
    } else if (insiderNet < 0.1) {
      insiderTrend = 'sell';
    }
  }

  return {
    institutional_ownership_percent: institutional,
    insider_trend: insiderTrend,
    etf_exposure: null,
  };
}

function emptyResearch(symbol) {
  return {
    symbol,
    overview: {
      price: null,
      change_percent: null,
      sector: null,
      industry: null,
      exchange: null,
      country: null,
    },
    fundamentals: {
      revenue_growth: null,
      eps_growth: null,
      margins: {
        gross_margin: null,
        net_margin: null,
      },
      cashflow: {
        free_cash_flow: null,
      },
      debt: {
        debt_to_equity: null,
      },
      dcf_value: null,
    },
    earnings: {
      next_date: null,
      expected_move: null,
      eps_estimate: null,
    },
    ownership: {
      institutional: null,
      insider: null,
      etf: null,
    },
  };
}

function mapCachedResearch(symbol, cached) {
  const overview = cached.overview || {};
  const fundamentals = cached.fundamentals || {};
  const earnings = cached.earnings || {};
  const ownership = cached.ownership || {};

  return {
    symbol,
    overview: {
      price: toNullableNumber(overview.price),
      change_percent: toNullableNumber(overview.change_percent),
      sector: toNullableString(overview.sector),
      industry: toNullableString(overview.industry),
      exchange: toNullableString(overview.exchange),
      country: toNullableString(overview.country),
    },
    fundamentals: {
      revenue_growth: toNullableNumber(fundamentals.revenue_growth),
      eps_growth: toNullableNumber(fundamentals.eps_growth),
      margins: {
        gross_margin: toNullableNumber(fundamentals.gross_margin),
        net_margin: toNullableNumber(fundamentals.net_margin),
      },
      cashflow: {
        free_cash_flow: toNullableNumber(fundamentals.free_cash_flow),
      },
      debt: {
        debt_to_equity: toNullableNumber(fundamentals.debt_to_equity),
      },
      dcf_value: toNullableNumber(fundamentals.dcf_value),
    },
    earnings: {
      next_date: earnings.next_earnings_date || null,
      expected_move: toNullableNumber(earnings.expected_move_percent),
      eps_estimate: toNullableNumber(earnings.eps_estimate),
    },
    ownership: {
      institutional: toNullableNumber(ownership.institutional_ownership_percent),
      insider: toNullableString(ownership.insider_trend),
      etf: toNullableNumber(ownership.etf_exposure),
    },
  };
}

function buildCacheMetadata(cachedRows) {
  const timestamps = [
    cachedRows.overview?.updated_at,
    cachedRows.fundamentals?.updated_at,
    cachedRows.ownership?.updated_at,
    cachedRows.earnings?.updated_at,
  ]
    .map(parseTimestamp)
    .filter((value) => value !== null);

  if (!timestamps.length) {
    return {
      updatedAt: null,
      isFresh: false,
      isComplete: false,
      ageMs: null,
    };
  }

  const updatedAt = Math.min(...timestamps);
  const ageMs = Date.now() - updatedAt;

  return {
    updatedAt: new Date(updatedAt).toISOString(),
    isFresh: ageMs < RESEARCH_CACHE_TTL_MS,
    isComplete: Boolean(cachedRows.overview && cachedRows.fundamentals && cachedRows.ownership && cachedRows.earnings),
    ageMs,
  };
}

async function fetchStable(path, params) {
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY missing');
  }

  const response = await axios.get(`${FMP_BASE}${path}`, {
    params: {
      ...params,
      apikey: FMP_API_KEY,
    },
    timeout: FMP_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`FMP ${path} failed (${response.status})`);
  }

  return response.data;
}

async function fetchStableSafe(path, params) {
  try {
    return await fetchStable(path, params);
  } catch (error) {
    console.warn('[RESEARCH] stable fetch failed', { path, symbol: params?.symbol || null, error: error.message });
    return null;
  }
}

async function readCachedResearchRows(symbol) {
  if (!supabaseAdmin) {
    return null;
  }

  const [overviewRes, fundamentalsRes, ownershipRes, earningsRes, macroRes] = await Promise.all([
    supabaseAdmin.from('research_snapshots').select('*').eq('symbol', symbol).maybeSingle(),
    supabaseAdmin.from('fundamentals_snapshot').select('*').eq('symbol', symbol).maybeSingle(),
    supabaseAdmin.from('ownership_snapshot').select('*').eq('symbol', symbol).maybeSingle(),
    supabaseAdmin.from('earnings_snapshot').select('*').eq('symbol', symbol).maybeSingle(),
    supabaseAdmin.from('macro_snapshot').select('*').eq('id', MACRO_ROW_ID).maybeSingle(),
  ]);

  const errors = [overviewRes, fundamentalsRes, ownershipRes, earningsRes, macroRes]
    .map((result) => result.error)
    .filter(Boolean);

  if (errors.length && errors.every(isMissingTableError)) {
    return null;
  }

  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join('; '));
  }

  return {
    overview: overviewRes.data || null,
    fundamentals: fundamentalsRes.data || null,
    ownership: ownershipRes.data || null,
    earnings: earningsRes.data || null,
    macro: macroRes.data || null,
  };
}

async function fetchExistingEarnings(symbol) {
  try {
    const result = await queryWithTimeout(
      `SELECT
         (
           SELECT report_date::text
           FROM earnings_events
           WHERE symbol = $1
             AND report_date >= CURRENT_DATE
           ORDER BY report_date ASC
           LIMIT 1
         ) AS next_earnings_date,
         (
           SELECT eps_estimate
           FROM earnings_events
           WHERE symbol = $1
             AND report_date >= CURRENT_DATE
           ORDER BY report_date ASC
           LIMIT 1
         ) AS eps_estimate,
         (
           SELECT expected_move_percent
           FROM earnings_events
           WHERE symbol = $1
             AND report_date >= CURRENT_DATE
           ORDER BY report_date ASC
           LIMIT 1
         ) AS expected_move_percent,
         (
           SELECT eps_surprise_pct
           FROM earnings_events
           WHERE symbol = $1
             AND report_date < CURRENT_DATE
           ORDER BY report_date DESC
           LIMIT 1
         ) AS last_surprise_percent`,
      [symbol],
      {
        timeoutMs: 1200,
        label: 'research.cached_earnings',
        maxRetries: 0,
      }
    );

    return result.rows?.[0] || null;
  } catch (_error) {
    return null;
  }
}

function buildTrend(row) {
  const price = toNullableNumber(row?.price);
  const sma20 = toNullableNumber(row?.sma_20);
  const sma50 = toNullableNumber(row?.sma_50);
  const change = toNullableNumber(row?.change_percent);

  if (price !== null && sma20 !== null && sma50 !== null) {
    if (price > sma20 && sma20 > sma50) {
      return 'uptrend';
    }
    if (price < sma20 && sma20 < sma50) {
      return 'downtrend';
    }
  }

  if (change !== null) {
    if (change > 0.25) {
      return 'uptrend';
    }
    if (change < -0.25) {
      return 'downtrend';
    }
  }

  return 'range';
}

async function buildMacroSnapshot() {
  const [indexResult, sectorResult] = await Promise.all([
    queryWithTimeout(
      `SELECT symbol, price, change_percent, sma_20, sma_50
       FROM market_metrics
       WHERE symbol IN ('SPY', 'QQQ', 'VIX')`,
      [],
      {
        timeoutMs: 1200,
        label: 'research.macro.indices',
        maxRetries: 0,
      }
    ),
    queryWithTimeout(
      `SELECT sector, AVG(change_percent)::numeric(12,4) AS avg_change
       FROM market_quotes
       WHERE sector IS NOT NULL
         AND TRIM(sector) <> ''
       GROUP BY sector
       ORDER BY AVG(change_percent) DESC
       LIMIT 8`,
      [],
      {
        timeoutMs: 1500,
        label: 'research.macro.sectors',
        maxRetries: 0,
      }
    ),
  ]);

  const bySymbol = new Map((indexResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
  const sectorStrength = (sectorResult.rows || []).map((row) => ({
    sector: toNullableString(row.sector),
    change_percent: toNullableNumber(row.avg_change),
  })).filter((row) => row.sector);

  return {
    id: MACRO_ROW_ID,
    spy_trend: buildTrend(bySymbol.get('SPY')),
    qqq_trend: buildTrend(bySymbol.get('QQQ')),
    vix_level: toNullableNumber(bySymbol.get('VIX')?.price),
    sector_strength_json: sectorStrength,
    updated_at: new Date().toISOString(),
  };
}

async function refreshMacroSnapshotIfNeeded(force = false) {
  if (!supabaseAdmin) {
    return null;
  }

  const existing = await supabaseAdmin
    .from('macro_snapshot')
    .select('*')
    .eq('id', MACRO_ROW_ID)
    .maybeSingle();

  const existingUpdatedAt = parseTimestamp(existing.data?.updated_at);
  const isFresh = existingUpdatedAt !== null && (Date.now() - existingUpdatedAt) < MACRO_CACHE_TTL_MS;
  if (!force && isFresh) {
    return existing.data;
  }

  const macro = await buildMacroSnapshot();
  const result = await supabaseAdmin.from('macro_snapshot').upsert(macro, { onConflict: 'id' }).select('*').single();
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data;
}

function normalizeEarnings(symbol, analystEstimateRow, cachedEarnings, profile, consensus) {
  const futureEstimate = analystEstimateRow || {};
  const overviewPrice = pickFirstNumber(profile || {}, ['price']);
  const targetHigh = pickFirstNumber(consensus || {}, ['targetHigh', 'target_high']);
  const targetLow = pickFirstNumber(consensus || {}, ['targetLow', 'target_low']);
  const consensusDispersion = targetHigh !== null && targetLow !== null && overviewPrice
    ? Number((((targetHigh - targetLow) / overviewPrice) * 100).toFixed(2))
    : null;

  return {
    symbol,
    next_earnings_date: cachedEarnings?.next_earnings_date || toNullableString(futureEstimate.date),
    eps_estimate: toNullableNumber(cachedEarnings?.eps_estimate) ?? pickFirstNumber(futureEstimate, ['estimatedEpsAvg', 'epsEstimated', 'eps_estimate']),
    expected_move_percent: toNullableNumber(cachedEarnings?.expected_move_percent) ?? consensusDispersion,
    last_surprise_percent: toNullableNumber(cachedEarnings?.last_surprise_percent),
  };
}

async function writeResearchCache(symbol, payload) {
  if (!supabaseAdmin) {
    return;
  }

  const stamp = new Date().toISOString();

  const writes = await Promise.all([
    supabaseAdmin.from('research_snapshots').upsert({
      symbol,
      ...payload.overview,
      updated_at: stamp,
    }, { onConflict: 'symbol' }),
    supabaseAdmin.from('fundamentals_snapshot').upsert({
      symbol,
      revenue_growth: payload.fundamentals.revenue_growth,
      eps_growth: payload.fundamentals.eps_growth,
      gross_margin: payload.fundamentals.margins.gross_margin,
      net_margin: payload.fundamentals.margins.net_margin,
      free_cash_flow: payload.fundamentals.cashflow.free_cash_flow,
      debt_to_equity: payload.fundamentals.debt.debt_to_equity,
      dcf_value: payload.fundamentals.dcf_value,
      updated_at: stamp,
    }, { onConflict: 'symbol' }),
    supabaseAdmin.from('ownership_snapshot').upsert({
      symbol,
      institutional_ownership_percent: payload.ownership.institutional,
      insider_trend: payload.ownership.insider,
      etf_exposure: payload.ownership.etf,
      updated_at: stamp,
    }, { onConflict: 'symbol' }),
    supabaseAdmin.from('earnings_snapshot').upsert({
      symbol,
      next_earnings_date: payload.earnings.next_date,
      eps_estimate: payload.earnings.eps_estimate,
      expected_move_percent: payload.earnings.expected_move,
      last_surprise_percent: payload.earnings.last_surprise_percent ?? null,
      updated_at: stamp,
    }, { onConflict: 'symbol' }),
  ]);

  const errors = writes.map((result) => result.error).filter(Boolean);
  if (errors.length && errors.every(isMissingTableError)) {
    console.warn('[RESEARCH] cache tables unavailable, serving uncached payload', { symbol });
    return;
  }

  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join('; '));
  }
}

async function fetchFreshResearch(symbol) {
  const [
    profilePayload,
    growthPayload,
    incomePayload,
    balancePayload,
    cashflowPayload,
    dcfPayload,
    estimatesPayload,
    consensusPayload,
  ] = await Promise.all([
    fetchStableSafe('/profile', { symbol }),
    fetchStableSafe('/financial-growth', { symbol, limit: 1 }),
    fetchStableSafe('/income-statement', { symbol, limit: 1 }),
    fetchStableSafe('/balance-sheet-statement', { symbol, limit: 1 }),
    fetchStableSafe('/cash-flow-statement', { symbol, limit: 1 }),
    fetchStableSafe('/discounted-cash-flow', { symbol }),
    fetchStableSafe('/analyst-estimates', { symbol, limit: 4 }),
    fetchStableSafe('/price-target-consensus', { symbol }),
  ]);

  const profile = firstRow(profilePayload);
  const growth = firstRow(growthPayload);
  const income = firstRow(incomePayload);
  const balance = firstRow(balancePayload);
  const cashflow = firstRow(cashflowPayload);
  const dcf = firstRow(dcfPayload);
  const consensus = firstRow(consensusPayload);
  const estimateRows = Array.isArray(estimatesPayload) ? estimatesPayload : [];
  const analystEstimateRow = estimateRows.find((row) => parseTimestamp(row?.date) !== null && parseTimestamp(row.date) >= Date.now()) || firstRow(estimatesPayload);
  const cachedEarnings = await fetchExistingEarnings(symbol);

  const overview = normalizeOverview(symbol, profile);
  const fundamentals = normalizeFundamentals(growth, income, balance, cashflow, dcf);
  const ownership = normalizeOwnership(profile, analystEstimateRow);
  const earnings = normalizeEarnings(symbol, analystEstimateRow, cachedEarnings, profile, consensus);

  const data = {
    symbol,
    overview: {
      price: overview.price,
      change_percent: overview.change_percent,
      sector: overview.sector,
      industry: overview.industry,
      exchange: overview.exchange,
      country: overview.country,
    },
    fundamentals: {
      revenue_growth: fundamentals.revenue_growth,
      eps_growth: fundamentals.eps_growth,
      margins: {
        gross_margin: fundamentals.gross_margin,
        net_margin: fundamentals.net_margin,
      },
      cashflow: {
        free_cash_flow: fundamentals.free_cash_flow,
      },
      debt: {
        debt_to_equity: fundamentals.debt_to_equity,
      },
      dcf_value: fundamentals.dcf_value,
    },
    earnings: {
      next_date: earnings.next_earnings_date,
      expected_move: earnings.expected_move_percent,
      eps_estimate: earnings.eps_estimate,
    },
    ownership: {
      institutional: ownership.institutional_ownership_percent,
      insider: ownership.insider_trend,
      etf: ownership.etf_exposure,
    },
  };

  await writeResearchCache(symbol, data);
  const context = await refreshMacroSnapshotIfNeeded(false).catch(() => null);

  return {
    data,
    context,
    updatedAt: new Date().toISOString(),
    source: 'fresh',
  };
}

function queueRefresh(symbol) {
  if (refreshInFlight.has(symbol)) {
    return refreshInFlight.get(symbol);
  }

  const promise = Promise.resolve()
    .then(() => fetchFreshResearch(symbol))
    .catch((error) => {
      console.warn('[RESEARCH] background refresh failed', { symbol, error: error.message });
      return null;
    })
    .finally(() => {
      refreshInFlight.delete(symbol);
    });

  refreshInFlight.set(symbol, promise);
  return promise;
}

async function getResearch(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) {
    throw new Error('Symbol is required');
  }

  const fallback = emptyResearch(symbol);

  let cachedRows = null;
  try {
    cachedRows = await readCachedResearchRows(symbol);
  } catch (error) {
    console.warn('[RESEARCH] cache read failed', { symbol, error: error.message });
  }

  if (cachedRows) {
    const cacheMeta = buildCacheMetadata(cachedRows);
    const data = mapCachedResearch(symbol, cachedRows);
    const context = cachedRows.macro || null;

    if (cacheMeta.isComplete && cacheMeta.isFresh) {
      return {
        data,
        context,
        meta: {
          symbol,
          source: 'cache',
          cached: true,
          stale: false,
          updated_at: cacheMeta.updatedAt,
          cache_age_ms: cacheMeta.ageMs,
        },
      };
    }

    if (cacheMeta.isComplete) {
      queueRefresh(symbol);
      if (!context || (parseTimestamp(context.updated_at) !== null && (Date.now() - parseTimestamp(context.updated_at)) > MACRO_CACHE_TTL_MS)) {
        void refreshMacroSnapshotIfNeeded(false).catch(() => null);
      }

      return {
        data,
        context,
        meta: {
          symbol,
          source: 'cache_stale',
          cached: true,
          stale: true,
          updated_at: cacheMeta.updatedAt,
          cache_age_ms: cacheMeta.ageMs,
        },
      };
    }
  }

  const fresh = await fetchFreshResearch(symbol);
  return {
    data: fresh.data || fallback,
    context: fresh.context,
    meta: {
      symbol,
      source: fresh.source,
      cached: false,
      stale: false,
      updated_at: fresh.updatedAt,
      cache_age_ms: 0,
    },
  };
}

module.exports = {
  getResearch,
  normalizeSymbol,
};
