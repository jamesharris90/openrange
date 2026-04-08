const express = require('express');

const { queryWithTimeout } = require('../db/pg');
const { getResearchTerminalPayload, normalizeSymbol } = require('../services/researchCacheService');
const { buildTruthDecisionFromPayload } = require('../services/truthEngine');
const { buildEarningsEdge: buildEarningsEdgeEngine } = require('../engines/earningsEdgeEngine');
const { getIndicators, getDailyTechnicalSummary, emptyIndicators } = require('../engines/indicatorEngine');
const { getCoverageStatusBySymbols } = require('../v2/services/coverageEngine');
const { getLatestScreenerPayload } = require('../v2/services/snapshotService');
const { computeDataConfidence, applyDataConfidenceGuard } = require('../services/dataConfidenceService');
const {
  buildDecisionScore,
  buildEarningsInsight,
  buildEarningsIntelligence,
  buildTradeProbability,
  calculateDrift,
} = require('../services/earningsIntelligence');

const router = express.Router();
const fullResponseCache = new Map();
const FULL_RESPONSE_TTL_MS = 30 * 1000;

const EMPTY_SCANNER_PAYLOAD = {
  momentum_flow: {
    price: null,
    change_percent: null,
    gap_percent: null,
    relative_volume: null,
    volume: null,
    premarket_change_percent: null,
    premarket_volume: null,
    change_from_open_percent: null,
  },
  market_structure: {
    market_cap: null,
    float_shares: null,
    short_float_percent: null,
    avg_volume: null,
    spread_percent: null,
    shares_outstanding: null,
    sector: null,
    exchange: null,
  },
  technical: {
    rsi14: null,
    atr_percent: null,
    adr_percent: null,
    from_52w_high_percent: null,
    from_52w_low_percent: null,
    above_vwap: null,
    above_sma20: null,
    above_sma50: null,
    above_sma200: null,
    squeeze_setup: null,
    new_hod: null,
    beta: null,
  },
  catalyst_events: {
    days_to_earnings: null,
    earnings_surprise_percent: null,
    has_news_today: null,
    recent_insider_buy: null,
    recent_upgrade: null,
    recent_insider_buy_summary: null,
    recent_upgrade_summary: null,
    institutional_ownership_percent: null,
    insider_ownership_percent: null,
  },
  fundamentals: {
    pe: null,
    ps: null,
    eps_growth_percent: null,
    revenue_growth_percent: null,
    debt_equity: null,
    roe_percent: null,
    fcf_yield_percent: null,
    dividend_yield_percent: null,
  },
  options_flow: {
    iv_rank: null,
    put_call_ratio: null,
    options_volume: null,
    options_volume_vs_30d: null,
    net_premium: null,
    unusual_options: null,
  },
};

function getFreshCachedResponse(cache, key, ttlMs) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if ((Date.now() - entry.timestamp) >= ttlMs) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function mapTerminalPayloadToSnapshot(symbol, payload) {
  return {
    symbol,
    overview: {
      price: payload?.price?.price ?? null,
      change_percent: payload?.price?.change_percent ?? null,
      sector: payload?.profile?.sector ?? null,
      industry: payload?.profile?.industry ?? null,
      exchange: payload?.profile?.exchange ?? null,
      country: payload?.profile?.country ?? null,
    },
    fundamentals: {
      revenue_growth: payload?.fundamentals?.revenue_growth ?? null,
      eps_growth: payload?.fundamentals?.eps_growth ?? null,
      margins: {
        gross_margin: payload?.fundamentals?.gross_margin ?? null,
        net_margin: payload?.fundamentals?.net_margin ?? null,
      },
      cashflow: {
        free_cash_flow: payload?.fundamentals?.free_cash_flow ?? null,
      },
      debt: {
        debt_to_equity: null,
      },
      dcf_value: null,
    },
    earnings: {
      next_date: payload?.earnings?.next?.date ?? null,
      expected_move: payload?.earnings?.next?.expected_move_percent ?? null,
      eps_estimate: payload?.earnings?.next?.eps_estimate ?? null,
    },
    ownership: {
      institutional: payload?.ownership?.institutional ?? null,
      insider: payload?.ownership?.insider ?? null,
      etf: payload?.ownership?.etf ?? null,
    },
  };
}

function toDecisionOutput({ earningsEdge, tradeProbability, context }) {
  const baseScore = buildDecisionScore({
    earningsEdge,
    regime: context?.regime,
  });
  const reliabilityScore = Number(tradeProbability?.reliabilityScore || 0);
  const followThrough = Number(tradeProbability?.beatFollowThrough || 0);
  const sectorTailwind = Boolean(context?.sectorTailwind);

  let tradeScore = Math.max(0, baseScore);
  if (reliabilityScore >= 3) tradeScore += 2;
  else if (reliabilityScore >= 1.5) tradeScore += 1;
  if (sectorTailwind) tradeScore += 1;
  if (followThrough >= 0.7) tradeScore += 1;

  tradeScore = Math.max(0, Math.min(10, tradeScore));

  const confidence = tradeScore >= 7 ? 'HIGH' : tradeScore >= 4 ? 'MEDIUM' : 'LOW';
  const message = tradeScore >= 7
    ? 'High probability continuation setup'
    : tradeScore <= 3
      ? 'Low conviction — avoid'
      : 'Moderate setup — wait for confirmation';

  return {
    tradeScore,
    confidence,
    message,
  };
}

function normalizeCoveragePayload(symbol, coverageMap) {
  const row = coverageMap instanceof Map ? coverageMap.get(symbol) : null;
  const score = Number(row?.coverage_score || 0);

  return {
    symbol,
    has_news: Boolean(row?.has_news),
    has_earnings: Boolean(row?.has_earnings),
    has_technicals: Boolean(row?.has_technicals),
    news_count: Number(row?.news_count || 0),
    earnings_count: Number(row?.earnings_count || 0),
    last_news_at: row?.last_news_at || null,
    last_earnings_at: row?.last_earnings_at || null,
    coverage_score: score,
    status: score >= 100 ? 'COMPLETE' : score >= 60 ? 'PARTIAL' : 'LOW',
    tradeable: score >= 60,
    last_checked: row?.last_checked || null,
  };
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBooleanOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return null;
}

function pickFirstNumber(objects, keys) {
  for (const source of objects) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      const value = toNumber(source[key]);
      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

function pickFirstMeaningfulNumber(objects, keys) {
  for (const source of objects) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      const value = toNumber(source[key]);
      if (value !== null && value !== 0) {
        return value;
      }
    }
  }

  return null;
}

function pickFirstBoolean(objects, keys) {
  for (const source of objects) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      const value = toBooleanOrNull(source[key]);
      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

function pickFirstString(objects, keys) {
  for (const source of objects) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      const value = String(source[key] || '').trim();
      if (value) {
        return value;
      }
    }
  }

  return null;
}

function normalizePercentLike(value) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return null;
  }

  if (Math.abs(numeric) <= 1) {
    return Number((numeric * 100).toFixed(2));
  }

  return Number(numeric.toFixed(2));
}

function computePercentDelta(current, reference) {
  const currentValue = toNumber(current);
  const referenceValue = toNumber(reference);
  if (currentValue === null || referenceValue === null || referenceValue === 0) {
    return null;
  }

  return Number((((currentValue - referenceValue) / referenceValue) * 100).toFixed(2));
}

function computeDaysUntil(value) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const now = new Date();
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = new Date(parsed);
  const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((targetDay - currentDay) / 86400000);
}

function isSameUtcDay(value) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
}

async function readSymbolTableRow(tableName, symbol, label) {
  try {
    const result = await queryWithTimeout(
      `SELECT to_jsonb(t) AS row
       FROM ${tableName} t
       WHERE UPPER(t.symbol) = UPPER($1)
       LIMIT 1`,
      [symbol],
      {
        timeoutMs: 1600,
        label,
        maxRetries: 0,
      }
    );

    return result.rows?.[0]?.row || null;
  } catch (error) {
    console.warn('[RESEARCH] metrics lookup failed', { symbol, tableName, error: error.message });
    return null;
  }
}

async function getResearchScannerSources(symbol) {
  const [marketQuote, marketMetrics, companyProfile, fundamentalsSnapshot, ownershipSnapshot, technicalIndicators, dailySummary] = await Promise.all([
    readSymbolTableRow('market_quotes', symbol, 'research.metrics.market_quotes'),
    readSymbolTableRow('market_metrics', symbol, 'research.metrics.market_metrics'),
    readSymbolTableRow('company_profiles', symbol, 'research.metrics.company_profiles'),
    readSymbolTableRow('fundamentals_snapshot', symbol, 'research.metrics.fundamentals_snapshot'),
    readSymbolTableRow('ownership_snapshot', symbol, 'research.metrics.ownership_snapshot'),
    readSymbolTableRow('technical_indicators', symbol, 'research.metrics.technical_indicators'),
    getDailyTechnicalSummary(symbol).catch((error) => {
      console.warn('[RESEARCH] daily summary lookup failed', { symbol, error: error.message });
      return null;
    }),
  ]);

  return {
    marketQuote,
    marketMetrics,
    companyProfile,
    fundamentalsSnapshot,
    ownershipSnapshot,
    technicalIndicators,
    dailySummary,
  };
}

function buildScannerPayload({ payload, indicators, coverage, scoreRow, sources }) {
  const marketQuote = sources?.marketQuote || {};
  const marketMetrics = sources?.marketMetrics || {};
  const companyProfile = sources?.companyProfile || {};
  const fundamentalsSnapshot = sources?.fundamentalsSnapshot || {};
  const ownershipSnapshot = sources?.ownershipSnapshot || {};
  const technicalIndicators = sources?.technicalIndicators || {};
  const dailySummary = sources?.dailySummary || {};
  const currentPrice = pickFirstNumber([payload?.price, marketQuote, marketMetrics, technicalIndicators], ['price', 'close']);
  const marketCap = pickFirstNumber([marketQuote, companyProfile], ['market_cap', 'marketCap']);
  const avgVolume = pickFirstNumber([marketMetrics, marketQuote], ['avg_volume_30d', 'avg_volume', 'average_volume']);
  const sma20 = pickFirstNumber([dailySummary], ['sma20']);
  const sma50 = pickFirstNumber([dailySummary], ['sma50']);
  const sma200 = pickFirstNumber([dailySummary], ['sma200']);
  const latestNewsDate = scoreRow?.latest_news_at || coverage?.last_news_at || null;
  const hasNewsToday = isSameUtcDay(latestNewsDate);
  const institutionalOwnership = normalizePercentLike(
    pickFirstMeaningfulNumber([payload?.ownership, ownershipSnapshot], ['institutional_ownership_percent', 'institutional'])
  );
  const recentInsiderBuySummary = pickFirstString([payload?.ownership], ['recent_insider_buy_summary']);
  const recentUpgradeSummary = pickFirstString([payload?.ownership], ['recent_upgrade_summary']);

  return {
    momentum_flow: {
      price: currentPrice,
      change_percent: pickFirstNumber([payload?.price, marketQuote, marketMetrics, scoreRow], ['change_percent']),
      gap_percent: pickFirstNumber([marketMetrics, scoreRow], ['gap_percent']),
      relative_volume: pickFirstNumber([marketMetrics, marketQuote, scoreRow], ['relative_volume', 'rvol']),
      volume: pickFirstNumber([marketQuote, marketMetrics, scoreRow], ['volume']),
      premarket_change_percent: pickFirstNumber([marketQuote, marketMetrics], ['pm_change', 'premarket_change_percent', 'premarket_change']),
      premarket_volume: pickFirstNumber([marketQuote, marketMetrics], ['premarket_volume', 'pm_volume']),
      change_from_open_percent: pickFirstNumber([marketQuote, marketMetrics], ['change_from_open', 'change_from_open_percent'])
        ?? computePercentDelta(currentPrice, pickFirstNumber([dailySummary], ['latest_open'])),
    },
    market_structure: {
      market_cap: marketCap ?? pickFirstNumber([payload?.profile], ['market_cap']),
      float_shares: pickFirstNumber([marketMetrics, companyProfile, marketQuote], ['float_shares', 'float']),
      short_float_percent: normalizePercentLike(
        pickFirstMeaningfulNumber([marketQuote, marketMetrics], ['short_float', 'short_percent_float', 'short_float_percent'])
      ),
      avg_volume: avgVolume,
      spread_percent: pickFirstNumber([marketQuote, marketMetrics], ['spread_pct', 'spread_percent']),
      shares_outstanding: pickFirstNumber([marketQuote, marketMetrics, companyProfile], ['shares_out', 'shares_outstanding'])
        ?? (marketCap !== null && currentPrice !== null && currentPrice !== 0 ? Number((marketCap / currentPrice).toFixed(0)) : null),
      sector: pickFirstString([payload?.profile, companyProfile, marketQuote, scoreRow], ['sector']),
      exchange: pickFirstString([payload?.profile, companyProfile, marketQuote], ['exchange']),
    },
    technical: {
      rsi14: pickFirstNumber([technicalIndicators, marketMetrics], ['rsi14', 'rsi']),
      atr_percent: pickFirstNumber([marketMetrics, marketQuote], ['atr_percent'])
        ?? (() => {
          const atr = pickFirstNumber([payload?.price, marketMetrics], ['atr']);
          return atr !== null && currentPrice !== null && currentPrice !== 0 ? Number(((atr / currentPrice) * 100).toFixed(2)) : null;
        })(),
      adr_percent: pickFirstNumber([dailySummary], ['adr_pct']),
      from_52w_high_percent: computePercentDelta(currentPrice, pickFirstNumber([dailySummary], ['high_52w'])),
      from_52w_low_percent: (() => {
        const low = pickFirstNumber([dailySummary], ['low_52w']);
        if (currentPrice === null || low === null || low === 0) {
          return null;
        }

        return Number((((currentPrice - low) / low) * 100).toFixed(2));
      })(),
      above_vwap: indicators?.structure?.above_vwap ?? pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['above_vwap']),
      above_sma20: pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['above_sma20'])
        ?? (currentPrice !== null && sma20 !== null ? currentPrice > sma20 : null),
      above_sma50: pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['above_sma50'])
        ?? (currentPrice !== null && sma50 !== null ? currentPrice > sma50 : null),
      above_sma200: pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['above_sma200'])
        ?? (currentPrice !== null && sma200 !== null ? currentPrice > sma200 : null),
      squeeze_setup: pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['squeeze', 'squeeze_setup']),
      new_hod: pickFirstBoolean([marketQuote, marketMetrics, scoreRow], ['new_hod'])
        ?? (() => {
          const sessionHigh = pickFirstNumber([dailySummary], ['session_high']);
          return currentPrice !== null && sessionHigh !== null ? currentPrice >= sessionHigh : null;
        })(),
      beta: pickFirstMeaningfulNumber([payload?.profile, companyProfile, marketQuote, marketMetrics], ['beta']),
    },
    catalyst_events: {
      days_to_earnings: computeDaysUntil(payload?.earnings?.next?.date),
      earnings_surprise_percent: pickFirstNumber([payload?.earnings?.history?.[0] || {}, payload?.earnings?.next || {}], ['surprise_percent', 'surprisePercent']),
      has_news_today: hasNewsToday === null ? Boolean(coverage?.has_news) : hasNewsToday,
      recent_insider_buy: recentInsiderBuySummary ? true : pickFirstBoolean([marketQuote, marketMetrics], ['insider_buy', 'recent_insider_buy']),
      recent_upgrade: recentUpgradeSummary ? true : pickFirstBoolean([marketQuote, marketMetrics], ['analyst_upgrade', 'recent_upgrade']),
      recent_insider_buy_summary: recentInsiderBuySummary,
      recent_upgrade_summary: recentUpgradeSummary,
      institutional_ownership_percent: institutionalOwnership,
      insider_ownership_percent: normalizePercentLike(
        pickFirstMeaningfulNumber([payload?.profile, ownershipSnapshot, marketQuote, marketMetrics], ['insider_ownership_percent', 'insider_ownership', 'insider_percent'])
      ),
    },
    fundamentals: {
      pe: pickFirstMeaningfulNumber([payload?.fundamentals, fundamentalsSnapshot, payload?.profile, marketQuote, marketMetrics, companyProfile], ['pe', 'pe_ratio', 'trailing_pe', 'trailingPE']),
      ps: pickFirstMeaningfulNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote, marketMetrics, companyProfile], ['ps', 'ps_ratio', 'price_to_sales', 'priceToSalesTrailing12Months']),
      eps_growth_percent: normalizePercentLike(pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote], ['eps_growth', 'epsGrowth'])),
      revenue_growth_percent: normalizePercentLike(pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote], ['revenue_growth', 'revenueGrowth', 'rev_growth'])),
      debt_equity: pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote, marketMetrics], ['debt_to_equity', 'debt_equity']),
      roe_percent: normalizePercentLike(pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote, marketMetrics], ['roe_percent', 'roe', 'return_on_equity'])),
      fcf_yield_percent: normalizePercentLike(pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote, marketMetrics], ['fcf_yield_percent', 'fcf_yield', 'free_cash_flow_yield'])),
      dividend_yield_percent: normalizePercentLike(pickFirstNumber([payload?.fundamentals, fundamentalsSnapshot, marketQuote, marketMetrics], ['dividend_yield_percent', 'dividend_yield', 'div_yield'])),
    },
    options_flow: {
      iv_rank: pickFirstNumber([marketQuote, marketMetrics], ['iv_rank']),
      put_call_ratio: pickFirstMeaningfulNumber([payload?.ownership, ownershipSnapshot, marketMetrics, marketQuote], ['put_call_ratio']),
      options_volume: pickFirstNumber([marketQuote, marketMetrics], ['opt_volume', 'options_volume', 'option_volume']),
      options_volume_vs_30d: pickFirstNumber([marketQuote, marketMetrics], ['opt_vol_vs_30d', 'options_volume_vs_30d', 'option_volume_vs_30d']),
      net_premium: pickFirstNumber([marketQuote, marketMetrics], ['net_premium']),
      unusual_options: pickFirstBoolean([marketQuote, marketMetrics], ['unusual_opts', 'unusual_options']),
    },
  };
}

function buildScorePayload({ scoreRow, coverage, dataConfidence }) {
  return {
    final_score: Number(scoreRow?.final_score || 0),
    tqi: Number(scoreRow?.tqi || 0),
    tqi_label: scoreRow?.tqi_label || 'D',
    coverage_score: Number(scoreRow?.coverage_score || coverage?.coverage_score || 0),
    data_confidence: Number(scoreRow?.data_confidence || dataConfidence?.data_confidence || 0),
    data_confidence_label: scoreRow?.data_confidence_label || dataConfidence?.data_confidence_label || 'POOR',
    tradeable: Boolean(scoreRow?.tradeable ?? coverage?.tradeable),
    updated_at: scoreRow?.updated_at || null,
  };
}

async function getCachedScoreRowsBySymbol() {
  const rowsBySymbol = new Map();
  const snapshot = await getLatestScreenerPayload();

  for (const row of Array.isArray(snapshot?.data) ? snapshot.data : []) {
    if (!row?.symbol) continue;
    rowsBySymbol.set(row.symbol, row);
  }

  return rowsBySymbol;
}

router.get('/:symbol/full', async (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);
  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'symbol_required',
      message: 'A valid symbol is required.',
    });
  }

  try {
    const startedAt = Date.now();
    const cachedResponse = getFreshCachedResponse(fullResponseCache, symbol, FULL_RESPONSE_TTL_MS);
    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    const [payload, indicators, coverageBySymbol, scoreRowsBySymbol, scannerSources] = await Promise.all([
      getResearchTerminalPayload(symbol),
      getIndicators(symbol),
      getCoverageStatusBySymbols([symbol]),
      getCachedScoreRowsBySymbol(),
      getResearchScannerSources(symbol),
    ]);
    const coverage = normalizeCoveragePayload(symbol, coverageBySymbol);
    const enrichedHistory = calculateDrift(buildEarningsIntelligence(payload.earnings?.history || []));
    const earningsInsight = buildEarningsInsight({
      earnings: {
        ...payload.earnings,
        history: enrichedHistory,
      },
      price: payload.price?.price,
      atr: payload.price?.atr,
    });
    const rawEarningsEdge = buildEarningsEdgeEngine(enrichedHistory);
    const tradeProbability = buildTradeProbability(enrichedHistory);
    const averageDrift1d = enrichedHistory
      .map((row) => Number(row?.drift1d))
      .filter((value) => Number.isFinite(value));
    const averageDrift3d = enrichedHistory
      .map((row) => Number(row?.drift3d))
      .filter((value) => Number.isFinite(value));
    const earningsEdge = {
      ...rawEarningsEdge,
      beatRate: rawEarningsEdge.beat_rate,
      missRate: Number((1 - Number(rawEarningsEdge.beat_rate || 0)).toFixed(4)),
      avgMove: rawEarningsEdge.avg_move,
      avgUpMove: rawEarningsEdge.avg_up_move,
      avgDownMove: rawEarningsEdge.avg_down_move,
      directionalBias: rawEarningsEdge.directional_bias,
      consistencyScore: rawEarningsEdge.consistency,
      edgeScore: rawEarningsEdge.edge_score,
      edgeLabel: rawEarningsEdge.edge_label,
      beatAvgMove: rawEarningsEdge.avg_up_move,
      avgDrift1d: averageDrift1d.length ? Number((averageDrift1d.reduce((sum, value) => sum + value, 0) / averageDrift1d.length).toFixed(2)) : null,
      avgDrift3d: averageDrift3d.length ? Number((averageDrift3d.reduce((sum, value) => sum + value, 0) / averageDrift3d.length).toFixed(2)) : null,
      followThroughPercent: Number(((tradeProbability.beatFollowThrough || 0) * 100).toFixed(2)),
      reliabilityScore: tradeProbability.reliabilityScore,
      confidenceLabel: 'LOW',
      earningsPattern: rawEarningsEdge.earnings_pattern || [],
    };
    const enrichedEarnings = {
      ...payload.earnings,
      history: enrichedHistory,
      pattern: earningsEdge.earnings_pattern || [],
      edge: earningsEdge,
      read: payload.earnings?.status === 'none'
        ? 'No upcoming earnings scheduled.'
        : payload.earnings?.status === 'partial'
          ? 'Upcoming earnings scheduled. Some event details are still estimating.'
          : earningsEdge.read,
    };
    const rawDecision = await buildTruthDecisionFromPayload({
      symbol,
      payload: {
        ...payload,
        earnings: enrichedEarnings,
      },
      earningsEdge,
    });
    const dataConfidence = computeDataConfidence({
      payload: {
        ...payload,
        earnings: enrichedEarnings,
      },
      indicators,
      coverage,
    });
    const decision = applyDataConfidenceGuard(rawDecision, dataConfidence);
    const whyMoving = decision.why_moving;
    earningsEdge.confidenceLabel = decision.confidence >= 70 ? 'HIGH' : decision.confidence >= 55 ? 'MEDIUM' : 'LOW';
    const score = buildScorePayload({
      scoreRow: scoreRowsBySymbol.get(symbol),
      coverage,
      dataConfidence,
    });
    const scanner = buildScannerPayload({
      payload,
      indicators,
      coverage,
      scoreRow: scoreRowsBySymbol.get(symbol),
      sources: scannerSources,
    });

    const response = {
      success: true,
      profile: payload.profile,
      price: payload.price,
      fundamentals: payload.fundamentals,
      earnings: enrichedEarnings,
      earningsInsight,
      earningsEdge,
      tradeProbability,
      indicators,
      coverage,
      score,
      scanner,
      data_confidence: dataConfidence.data_confidence,
      data_confidence_label: dataConfidence.data_confidence_label,
      freshness_score: dataConfidence.freshness_score,
      source_quality: dataConfidence.source_quality,
      decision,
      why_moving: whyMoving,
      ownership: payload.ownership,
      context: payload.context,
      meta: {
        ...(payload.meta || {}),
        total_ms: Date.now() - startedAt,
      },
    };

    fullResponseCache.set(symbol, {
      data: response,
      timestamp: Date.now(),
    });

    return res.json(response);
  } catch (error) {
    console.warn('[RESEARCH] full request failed', { symbol, error: error.message });
    const fallbackDataConfidence = {
      data_confidence: 0,
      data_confidence_label: 'POOR',
      freshness_score: 0,
      source_quality: 0,
    };

    return res.json({
      success: false,
      error: 'research_full_unavailable',
      message: error.message,
      profile: {},
      price: {},
      fundamentals: {},
      earnings: {
        history: [],
        next: null,
        pattern: [],
        source: 'fallback',
        status: 'none',
        updated_at: null,
        edge: {
          beat_rate: 0,
          avg_move: 0,
          avg_up_move: 0,
          avg_down_move: 0,
          directional_bias: 'MIXED',
          consistency: 0,
          edge_score: 0,
          edge_label: 'NO_EDGE',
          read: 'No upcoming earnings scheduled.',
          sample_size: 0,
          earnings_pattern: [],
          beatRate: 0,
          avgMove: 0,
          avgUpMove: 0,
          avgDownMove: 0,
          directionalBias: 'MIXED',
          consistencyScore: 0,
          edgeScore: 0,
          edgeLabel: 'NO_EDGE',
          avgDrift1d: null,
          avgDrift3d: null,
          followThroughPercent: 0,
          reliabilityScore: 0,
          confidenceLabel: 'LOW',
          earningsPattern: [],
        },
        read: 'No upcoming earnings scheduled.',
      },
      earningsInsight: {
        beatRate: 0,
        missRate: 0,
        avgSurprise: 0,
        expectedMove: 0,
        tradeable: false,
      },
      earningsEdge: {
        beat_rate: 0,
        avg_move: 0,
        avg_up_move: 0,
        avg_down_move: 0,
        directional_bias: 'MIXED',
        consistency: 0,
        edge_score: 0,
        edge_label: 'NO_EDGE',
        read: 'No upcoming earnings scheduled.',
        sample_size: 0,
        earnings_pattern: [],
        beatRate: 0,
        missRate: 0,
        avgMove: 0,
        avgUpMove: 0,
        avgDownMove: 0,
        beatAvgMove: 0,
        directionalBias: 'MIXED',
        consistencyScore: 0,
        edgeScore: 0,
        edgeLabel: 'NO_EDGE',
        avgDrift1d: null,
        avgDrift3d: null,
        followThroughPercent: 0,
        reliabilityScore: 0,
        confidenceLabel: 'LOW',
        earningsPattern: [],
      },
      indicators: emptyIndicators(),
      coverage: {
        symbol,
        has_news: false,
        has_earnings: false,
        has_technicals: false,
        news_count: 0,
        earnings_count: 0,
        last_news_at: null,
        last_earnings_at: null,
        coverage_score: 0,
        status: 'LOW',
        tradeable: false,
        last_checked: null,
      },
      score: {
        final_score: 0,
        tqi: 0,
        tqi_label: 'D',
        coverage_score: 0,
        data_confidence: 0,
        data_confidence_label: 'POOR',
        tradeable: false,
        updated_at: null,
      },
      scanner: EMPTY_SCANNER_PAYLOAD,
      data_confidence: fallbackDataConfidence.data_confidence,
      data_confidence_label: fallbackDataConfidence.data_confidence_label,
      tradeProbability: {
        beatFollowThrough: 0,
        reliabilityScore: 0,
      },
      decision: {
        symbol,
        tradeable: false,
        confidence: 20,
        freshness_score: fallbackDataConfidence.freshness_score,
        source_quality: fallbackDataConfidence.source_quality,
        setup: 'NO_SETUP',
        bias: 'NEUTRAL',
        driver: 'NO_DRIVER',
        earnings_edge: {
          label: 'NO_EDGE',
          score: 0,
          bias: 'NEUTRAL',
          next_date: null,
          report_time: null,
          expected_move_percent: null,
          status: 'none',
          read: 'No upcoming earnings scheduled.',
        },
        risk_flags: ['LOW_CONVICTION', 'NO_STRUCTURED_SETUP'],
        status: 'AVOID',
        action: 'AVOID',
        why: 'No clean driver confirmed.',
        how: 'Wait for a cleaner setup.',
        risk: 'Avoid trading without confirmation.',
        narrative: {
          why_this_matters: 'No clean catalyst or setup is confirmed right now.',
          what_to_do: 'Wait for a clear driver, stronger volume, and a structured setup.',
          what_to_avoid: 'Avoid forcing a trade into low-conviction conditions.',
          source: 'deterministic_fallback',
          locked: true,
        },
        execution_plan: null,
        source: 'truth_engine',
      },
      why_moving: {
        driver: 'NO_DRIVER',
        summary: 'No earnings within 48 hours, no high-impact news, RVOL is below 2.0, and no confirmed breakout or breakdown is present.',
        tradeability: 'LOW',
        confidence_score: 20,
        bias: 'NEUTRAL',
        what_to_do: 'DO NOT TRADE. Wait for a confirmed catalyst or RVOL above 2.0.',
        what_to_avoid: 'Do not build a position off low-volume drift or recycled headlines.',
        setup: 'No valid setup.',
        trade_plan: null,
        action: 'DO NOT TRADE',
      },
      ownership: {},
      context: {},
      meta: {
        source: 'error',
        cached: false,
        stale: true,
        updated_at: null,
        total_ms: 0,
      },
    });
  }
});

router.get('/:symbol', async (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);
  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'symbol_required',
      message: 'A valid symbol is required.',
    });
  }

  try {
    const [result, indicators, coverageBySymbol] = await Promise.all([
      getResearchTerminalPayload(symbol),
      getIndicators(symbol),
      getCoverageStatusBySymbols([symbol]),
    ]);
    const coverage = normalizeCoveragePayload(symbol, coverageBySymbol);
    const rawDecision = await buildTruthDecisionFromPayload({
      symbol,
      payload: result,
    });
    const dataConfidence = computeDataConfidence({ payload: result, indicators, coverage });
    const decision = applyDataConfidenceGuard(rawDecision, dataConfidence);
    const whyMoving = decision.why_moving;
    return res.json({
      success: true,
      data: {
        ...mapTerminalPayloadToSnapshot(symbol, result),
        decision,
        why_moving: whyMoving,
        data_confidence: dataConfidence.data_confidence,
        data_confidence_label: dataConfidence.data_confidence_label,
      },
      data_confidence: dataConfidence.data_confidence,
      data_confidence_label: dataConfidence.data_confidence_label,
      decision,
      why_moving: whyMoving,
      context: result.context || null,
      meta: {
        symbol,
        source: `${result.meta?.source || 'cache'},snapshot`,
        cached: Boolean(result.meta?.cached),
        stale: Boolean(result.meta?.stale),
        updated_at: result.meta?.updated_at || null,
        cache_age_ms: null,
      },
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: 'research_unavailable',
      message: error.message,
      data: null,
      context: null,
    });
  }
});

module.exports = router;
