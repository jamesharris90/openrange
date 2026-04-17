const express = require('express');

const { buildNarrative } = require('../services/narrativeService');
const { getCache, setCache } = require('../cache/memoryCache');
const { normalizeSymbol } = require('../../services/researchCacheService');
const { queryWithTimeout } = require('../../db/pg');
const { computeCompletenessConfidence, hasChartCandles, hasCompleteTechnicals } = require('../../services/dataConfidenceService');
const { getLatestScreenerPayload } = require('../services/snapshotService');
const { buildMCP, getResearchData } = require('../services/researchService');
const { buildFastResearchSnapshot } = require('../services/experienceSnapshotService');

const router = express.Router();
const FULL_RESEARCH_CACHE_TTL_MS = 120000;
const FULL_RESEARCH_BUDGET_MS = 2500;
const fullResearchRefreshInFlight = new Map();

function getDefaultMCP(symbol) {
  return {
    summary: 'No edge — avoid until conditions improve',
    why: `${symbol} lacks enough confirmed edge to justify action yet.`,
    what: 'Wait for cleaner confirmation and stronger participation.',
    where: 'Use trigger and invalidation levels from the main research console.',
    when: 'Avoid until the setup confirms.',
    confidence: 20,
    confidence_reason: 'Limited because the route is serving a compatibility payload.',
    trade_quality: 'LOW',
    improve: 'Needs stronger momentum, clearer catalyst, and supportive regime.',
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
    chart: { intraday: [], daily: [] },
    news: [],
    earnings: { latest: null, next: null },
    company: {},
    mcp: getDefaultMCP(symbol),
    warnings: [],
  };
}

function mapTerminalToResearchData(symbol, payload) {
  const price = payload?.price || {};
  const profile = payload?.profile || {};
  const earnings = payload?.earnings || {};
  const nextEarnings = earnings?.next || null;
  const latestEarnings = Array.isArray(earnings?.history) ? earnings.history[0] || null : null;
  const tailwind = Boolean(payload?.context?.sectorTailwind);
  const regime = String(payload?.context?.regime || 'MIXED');
  const action = regime === 'RISK_OFF' ? 'AVOID' : tailwind ? 'WATCH' : 'WAIT';
  const tradeScore = regime === 'RISK_OFF' ? 20 : tailwind ? 65 : 40;

  return {
    ...emptyResearchData(symbol),
    market: {
      price: price.price ?? null,
      change_percent: price.change_percent ?? null,
      volume: null,
      market_cap: null,
      relative_volume: null,
      updated_at: price.updated_at || null,
    },
    technicals: {
      atr: price.atr ?? null,
      relative_volume: null,
    },
    earnings: {
      latest: latestEarnings ? {
        report_date: latestEarnings.date || null,
        report_time: latestEarnings.report_time || null,
        eps_estimate: latestEarnings.eps_estimate ?? null,
        eps_actual: latestEarnings.eps_actual ?? null,
      } : null,
      next: nextEarnings ? {
        report_date: nextEarnings.date || null,
        report_time: nextEarnings.report_time || null,
        eps_estimate: nextEarnings.eps_estimate ?? null,
        eps_actual: nextEarnings.eps_actual ?? null,
      } : null,
    },
    company: {
      company_name: profile.company_name || symbol,
      sector: profile.sector || null,
      industry: profile.industry || null,
      description: profile.description || null,
      exchange: profile.exchange || null,
      country: profile.country || null,
      website: profile.website || null,
    },
    mcp: {
      ...getDefaultMCP(symbol),
      summary: tailwind ? 'Developing setup — wait for confirmation' : 'No edge — avoid until conditions improve',
      why: payload?.context?.narrative || `${symbol} is moving without enough confirmed alignment yet.`,
      what: regime === 'RISK_OFF' ? 'Risk conditions are defensive.' : 'Monitor for continuation if price confirms.',
      where: 'Use the main research decision console for trigger levels.',
      when: regime === 'RISK_OFF' ? 'Avoid until the regime improves.' : 'Act only on confirmation.',
      confidence: tradeScore,
      confidence_reason: tailwind ? 'Sector tailwind improves the setup.' : 'Regime and participation are mixed.',
      trade_quality: tradeScore >= 60 ? 'MEDIUM' : 'LOW',
      improve: 'Needs stronger participation and confirmation through trigger levels.',
      action,
      trade_score: tradeScore,
      expected_move: {
        value: nextEarnings?.expected_move_percent ?? null,
        percent: nextEarnings?.expected_move_percent ?? null,
        label: (nextEarnings?.expected_move_percent ?? 0) >= 4 ? 'MEDIUM' : 'LOW',
      },
    },
    warnings: payload?.meta?.stale ? ['cache_stale'] : [],
  };
}

function buildDeterministicNarrative(symbol, screenerRow = {}) {
  const confidence = Number(screenerRow.confidence || 0);
  const changePercent = Number(screenerRow.change_percent || 0);
  const relativeVolume = Number(screenerRow.rvol || screenerRow.relative_volume || 0);
  const driver = String(screenerRow.why || `${symbol} is moving without a confirmed catalyst`).trim();
  const tradeable = confidence >= 0.55 && Math.abs(changePercent) >= 3;
  const bias = tradeable ? 'continuation' : 'chop';
  const strength = confidence >= 0.7 || Math.abs(changePercent) >= 6 ? 'strong' : 'weak';
  const risk = confidence >= 0.8 ? 'low' : confidence >= 0.5 ? 'medium' : 'high';

  return {
    summary: `${driver}. ${tradeable ? 'The move has enough confirmation to monitor for follow-through.' : 'The move still needs better confirmation before it is actionable.'}`,
    driver,
    strength,
    tradeable,
    bias,
    setup_type: tradeable ? 'momentum continuation' : 'chop / avoid',
    confidence_reason: relativeVolume >= 2
      ? 'Relative volume confirms participation behind the move.'
      : 'Participation is still too limited to fully trust the move.',
    watch: changePercent >= 0
      ? 'Watch for a VWAP reclaim and break of the intraday high.'
      : 'Watch for failure at VWAP and a break below the intraday low.',
    risk,
    generated_at: new Date().toISOString(),
  };
}

async function buildFastNarrative(symbol, mcp, screenerRow) {
  const fallback = {
    summary: String(mcp?.summary || buildDeterministicNarrative(symbol, screenerRow).summary),
    explanation: [mcp?.why, mcp?.what, mcp?.where, mcp?.when].filter(Boolean).join(' '),
    generated_at: new Date().toISOString(),
  };

  try {
    return await Promise.race([
      buildNarrative(mcp),
      new Promise((resolve) => {
        setTimeout(() => resolve(fallback), 50);
      }),
    ]);
  } catch (_error) {
    return fallback;
  }
}

function buildSyntheticScreenerRow(symbol, data) {
  const latestNews = Array.isArray(data.news) ? data.news[0] : null;
  const nextEarnings = data.earnings?.next || null;
  const relativeVolume = Number(data.market?.relative_volume ?? data.technicals?.relative_volume ?? 0);
  const changePercent = Number(data.market?.change_percent || 0);
  const hasNews = Boolean(latestNews?.title);
  const hasEarnings = Boolean(nextEarnings?.report_date);
  const catalystType = hasNews ? 'NEWS' : hasEarnings ? 'EARNINGS' : 'TECHNICAL';
  const driverType = hasNews ? 'NEWS' : hasEarnings ? 'EARNINGS' : 'TECHNICAL';
  const confidence = Math.max(
    0.25,
    Math.min(0.9, 0.35 + Math.min(Math.abs(changePercent) / 20, 0.25) + Math.min(relativeVolume / 8, 0.3) + (hasNews ? 0.1 : 0))
  );

  return {
    symbol,
    price: data.market?.price ?? null,
    change_percent: data.market?.change_percent ?? null,
    volume: data.market?.volume ?? null,
    rvol: data.market?.relative_volume ?? data.technicals?.relative_volume ?? null,
    gap_percent: null,
    latest_news_at: latestNews?.published_at || null,
    news_source: hasNews ? 'database' : 'none',
    earnings_date: nextEarnings?.report_date || null,
    earnings_source: hasEarnings ? 'database' : 'none',
    catalyst_type: catalystType,
    sector: data.company?.sector || null,
    updated_at: data.market?.updated_at || null,
    why: hasNews
      ? `Recent news flow is driving ${symbol}`
      : hasEarnings
        ? `${symbol} has an upcoming earnings catalyst`
        : `${symbol} is moving on technical price action`,
    driver_type: driverType,
    confidence,
    linked_symbols: [],
  };
}

function buildResponse(symbol, data, meta, source = 'snapshot') {
  const warnings = Array.from(new Set([
    ...(Array.isArray(data?.warnings) ? data.warnings : []),
    ...(Array.isArray(meta?.warnings) ? meta.warnings : []),
  ]));

  const responseMeta = {
    response_ms: Number(meta?.response_ms || 0),
    fallback: Boolean(meta?.fallback),
    reason: meta?.reason || null,
    phase: meta?.phase || 'full',
    source: meta?.source || source,
    warnings,
  };

  return {
    success: true,
    status: 'ok',
    source,
    data_confidence: data?.data_confidence ?? 0,
    data_confidence_label: data?.data_confidence_label || 'LOW',
    data_quality_label: data?.data_quality_label || data?.data_confidence_label || 'LOW',
    data: {
      ...emptyResearchData(symbol),
      ...data,
      meta: responseMeta,
    },
    meta: responseMeta,
  };
}

function fullResearchCacheKey(symbol) {
  return `research:full:${symbol}`;
}

async function buildFullResearchPayload(symbol) {
  const startedAt = Date.now();
  const fastSnapshot = await buildFastResearchSnapshot(symbol).catch(() => null);
  const fastData = fastSnapshot?.data || null;
  const data = await getResearchData(symbol);
  const dbBackfilledData = await enrichResearchDataFromDb(symbol, data);
  const snapshotScreenerRow = await getSnapshotScreenerRow(symbol);
  const screenerRow = snapshotScreenerRow || buildSyntheticScreenerRow(symbol, dbBackfilledData);
  const researchData = enrichResearchDataFromScreener(symbol, dbBackfilledData, snapshotScreenerRow);

  if (fastData) {
    researchData.company = {
      ...(fastData.company || {}),
      ...(researchData.company || {}),
      company_name: researchData.company?.company_name || fastData.company?.company_name || symbol,
      sector: researchData.company?.sector || fastData.company?.sector || null,
      industry: researchData.company?.industry || fastData.company?.industry || null,
      exchange: researchData.company?.exchange || fastData.company?.exchange || null,
      country: researchData.company?.country || fastData.company?.country || null,
      website: researchData.company?.website || fastData.company?.website || null,
      description: researchData.company?.description || fastData.company?.description || null,
    };

    researchData.earnings = {
      ...(fastData.earnings || {}),
      ...(researchData.earnings || {}),
      latest: researchData.earnings?.latest || fastData.earnings?.latest || null,
      next: researchData.earnings?.next?.report_date ? researchData.earnings.next : (fastData.earnings?.next || null),
      history: Array.isArray(researchData.earnings?.history) && researchData.earnings.history.length
        ? researchData.earnings.history
        : (Array.isArray(fastData.earnings?.history) ? fastData.earnings.history : []),
    };
  }

  researchData.screener = screenerRow;
  researchData.narrative = await buildFastNarrative(symbol, researchData.mcp, screenerRow);

  if (snapshotScreenerRow) {
    researchData.company = {
      ...researchData.company,
      sector: researchData.company?.sector || screenerRow.sector || null,
    };
    if (
      (
        data.market?.price == null
        || data.market?.volume == null
        || data.market?.market_cap == null
        || !hasCompleteTechnicals(data.technicals)
        || !data.earnings?.next?.report_date
      )
      && !(researchData.warnings || []).includes('snapshot_screener_backfill')
    ) {
      researchData.warnings = [...(researchData.warnings || []), 'snapshot_screener_backfill'];
    }
  } else {
    researchData.warnings = [...(researchData.warnings || []), 'synthetic_screener_row'];
  }

  return buildResponse(symbol, researchData, {
    response_ms: Date.now() - startedAt,
    fallback: false,
    reason: null,
    phase: 'full',
    source: 'database',
  }, 'database');
}

function getCachedFullResearchPayload(symbol) {
  return getCache(fullResearchCacheKey(symbol));
}

async function refreshFullResearchPayload(symbol) {
  if (fullResearchRefreshInFlight.has(symbol)) {
    return fullResearchRefreshInFlight.get(symbol);
  }

  const promise = buildFullResearchPayload(symbol)
    .then((payload) => {
      setCache(fullResearchCacheKey(symbol), payload, FULL_RESEARCH_CACHE_TTL_MS);
      return payload;
    })
    .finally(() => {
      fullResearchRefreshInFlight.delete(symbol);
    });

  fullResearchRefreshInFlight.set(symbol, promise);
  return promise;
}

async function getSnapshotScreenerRow(symbol) {
  try {
    const screenerPayload = await getLatestScreenerPayload();
    const rows = screenerPayload?.success && Array.isArray(screenerPayload.data)
      ? screenerPayload.data
      : [];

    return rows.find((row) => normalizeSymbol(row?.symbol) === symbol) || null;
  } catch (_error) {
    return null;
  }
}

async function enrichResearchDataFromDb(symbol, data) {
  if (data?.market?.market_cap != null && hasCompleteTechnicals(data?.technicals)) {
    return data;
  }

  try {
    const result = await queryWithTimeout(
      `SELECT
         q.price,
         q.volume,
         q.market_cap,
         q.relative_volume,
         q.updated_at,
         m.atr,
         m.rsi,
         m.vwap,
         m.avg_volume_30d,
         m.relative_volume AS metrics_relative_volume
       FROM market_quotes q
       LEFT JOIN market_metrics m ON m.symbol = q.symbol
       WHERE q.symbol = $1
       ORDER BY q.updated_at DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      {
        timeoutMs: 6000,
        label: 'research.route.market_technical_backfill',
        maxRetries: 1,
      }
    );

    const row = result.rows?.[0] || null;
    if (!row) {
      return data;
    }

    return {
      ...data,
      market: {
        ...(data.market || {}),
        price: data.market?.price ?? row.price ?? null,
        volume: data.market?.volume ?? row.volume ?? null,
        market_cap: data.market?.market_cap ?? row.market_cap ?? null,
        relative_volume: data.market?.relative_volume ?? row.relative_volume ?? row.metrics_relative_volume ?? null,
        updated_at: data.market?.updated_at || row.updated_at || null,
      },
      technicals: {
        ...(data.technicals || {}),
        atr: data.technicals?.atr ?? row.atr ?? null,
        rsi: data.technicals?.rsi ?? row.rsi ?? null,
        vwap: data.technicals?.vwap ?? row.vwap ?? null,
        relative_volume: data.technicals?.relative_volume ?? row.metrics_relative_volume ?? row.relative_volume ?? null,
        avg_volume_30d: data.technicals?.avg_volume_30d ?? row.avg_volume_30d ?? null,
      },
    };
  } catch (_error) {
    return data;
  }
}

function enrichResearchDataFromScreener(symbol, data, screenerRow) {
  if (!screenerRow) {
    return data;
  }

  const nextEarnings = data.earnings?.next?.report_date
    ? data.earnings.next
    : screenerRow.earnings_date
      ? {
          symbol,
          report_date: screenerRow.earnings_date,
          report_time: null,
          eps_estimate: null,
          eps_actual: null,
          revenue_estimate: null,
          revenue_actual: null,
          market_cap: data.market?.market_cap ?? null,
          sector: data.company?.sector || screenerRow.sector || null,
          industry: data.company?.industry || screenerRow.industry || null,
        }
      : null;

  const nextData = {
    ...data,
    market: {
      ...(data.market || {}),
      price: data.market?.price ?? screenerRow.price ?? null,
      market_cap: data.market?.market_cap ?? screenerRow.market_cap ?? null,
      change_percent: data.market?.change_percent ?? screenerRow.change_percent ?? null,
      volume: data.market?.volume ?? screenerRow.volume ?? null,
      relative_volume: data.market?.relative_volume ?? screenerRow.rvol ?? null,
      updated_at: data.market?.updated_at || screenerRow.updated_at || null,
    },
    technicals: {
      ...(data.technicals || {}),
      atr: data.technicals?.atr ?? screenerRow.atr ?? null,
      rsi: data.technicals?.rsi ?? screenerRow.rsi ?? null,
      vwap: data.technicals?.vwap ?? screenerRow.vwap ?? null,
      relative_volume: data.technicals?.relative_volume ?? screenerRow.rvol ?? null,
      avg_volume_30d: data.technicals?.avg_volume_30d ?? screenerRow.avg_volume_30d ?? null,
    },
    company: {
      ...(data.company || {}),
      company_name: data.company?.company_name || screenerRow.company_name || screenerRow.name || symbol,
      sector: data.company?.sector || screenerRow.sector || null,
      industry: data.company?.industry || screenerRow.industry || null,
      exchange: data.company?.exchange || screenerRow.exchange || null,
    },
    earnings: {
      ...(data.earnings || {}),
      next: nextEarnings,
    },
  };

  nextData.mcp = buildMCP(nextData);

  return {
    ...nextData,
    ...computeCompletenessConfidence({
      has_price: nextData.market?.price !== null && nextData.market?.price !== undefined,
      has_volume: nextData.market?.volume !== null && nextData.market?.volume !== undefined,
      has_chart_data: hasChartCandles(nextData.chart),
      has_technicals: hasCompleteTechnicals(nextData.technicals),
      has_earnings: Boolean(nextData.earnings?.next?.report_date),
    }),
  };
}

router.get('/:symbol', async (req, res) => {
  const startedAt = Date.now();
  const symbol = normalizeSymbol(req.params.symbol);
  console.log('[V2 RESEARCH INPUT]', { symbol });

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: 'Symbol is required',
    });
  }

  const fastSnapshot = await buildFastResearchSnapshot(symbol).catch(() => null);
  const fastResponse = buildResponse(
    symbol,
    fastSnapshot?.data || emptyResearchData(symbol),
    {
      response_ms: fastSnapshot?.meta?.response_ms || (Date.now() - startedAt),
      fallback: false,
      reason: null,
      phase: 'fast',
      source: fastSnapshot?.meta?.source || 'snapshot',
    },
    fastSnapshot?.meta?.source || 'snapshot'
  );

  if (String(req.query.fast || '').trim().toLowerCase() === 'true') {
    return res.json(fastResponse);
  }

  const cachedFull = getCachedFullResearchPayload(symbol);
  if (cachedFull?.data) {
    return res.json({
      ...cachedFull,
      meta: {
        ...cachedFull.meta,
        response_ms: Date.now() - startedAt,
        phase: 'full_cache',
      },
      data: {
        ...cachedFull.data,
        meta: {
          ...(cachedFull.data?.meta || {}),
          response_ms: Date.now() - startedAt,
          phase: 'full_cache',
        },
      },
    });
  }

  try {
    const fullPayload = await Promise.race([
      refreshFullResearchPayload(symbol),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('full_research_timeout')), FULL_RESEARCH_BUDGET_MS);
      }),
    ]);

    return res.json(fullPayload);
  } catch (error) {
    console.warn('[RESEARCH] route fallback', { symbol, error: error.message });
    void refreshFullResearchPayload(symbol).catch(() => {});
    return res.json({
      ...fastResponse,
      meta: {
        ...fastResponse.meta,
        response_ms: Date.now() - startedAt,
        fallback: true,
        reason: error.message || 'timeout',
        phase: 'fast_fallback',
      },
      data: {
        ...fastResponse.data,
        meta: {
          ...(fastResponse.data?.meta || {}),
          response_ms: Date.now() - startedAt,
          fallback: true,
          reason: error.message || 'timeout',
          phase: 'fast_fallback',
        },
      },
    });
  }
});

module.exports = router;