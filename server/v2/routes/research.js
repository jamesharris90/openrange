const express = require('express');

const { buildNarrative } = require('../services/narrativeService');
const { normalizeSymbol } = require('../../services/researchCacheService');
const { computeCompletenessConfidence, hasChartCandles, hasCompleteTechnicals } = require('../../services/dataConfidenceService');
const { getLatestScreenerPayload } = require('../services/snapshotService');
const { buildMCP, getResearchData } = require('../services/researchService');

const router = express.Router();

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
      change_percent: data.market?.change_percent ?? screenerRow.change_percent ?? null,
      volume: data.market?.volume ?? screenerRow.volume ?? null,
      relative_volume: data.market?.relative_volume ?? screenerRow.rvol ?? null,
      updated_at: data.market?.updated_at || screenerRow.updated_at || null,
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

  try {
    const data = await getResearchData(symbol);
    const snapshotScreenerRow = await getSnapshotScreenerRow(symbol);
    const screenerRow = snapshotScreenerRow || buildSyntheticScreenerRow(symbol, data);
    const researchData = enrichResearchDataFromScreener(symbol, data, snapshotScreenerRow);
    console.log('[V2 RESEARCH MARKET]', {
      symbol,
      price: researchData.market?.price ?? null,
      volume: researchData.market?.volume ?? null,
      marketCap: researchData.market?.market_cap ?? null,
    });
    console.log('[V2 RESEARCH TECHNICALS]', {
      symbol,
      rsi: researchData.technicals?.rsi ?? null,
      vwap: researchData.technicals?.vwap ?? null,
      atr: researchData.technicals?.atr ?? null,
    });
    console.log('[V2 RESEARCH CHART]', {
      symbol,
      candle_count: (Array.isArray(researchData.chart?.intraday) ? researchData.chart.intraday.length : 0)
        || (Array.isArray(researchData.chart?.daily) ? researchData.chart.daily.length : 0),
      intraday_count: Array.isArray(researchData.chart?.intraday) ? researchData.chart.intraday.length : 0,
      daily_count: Array.isArray(researchData.chart?.daily) ? researchData.chart.daily.length : 0,
    });

    researchData.screener = screenerRow;
    researchData.narrative = await buildFastNarrative(symbol, researchData.mcp, screenerRow);
    if (snapshotScreenerRow) {
      researchData.company = {
        ...researchData.company,
        sector: researchData.company?.sector || screenerRow.sector || null,
      };
      if (
        (data.market?.price == null || data.market?.volume == null || !data.earnings?.next?.report_date)
        && !(researchData.warnings || []).includes('snapshot_screener_backfill')
      ) {
        researchData.warnings = [...(researchData.warnings || []), 'snapshot_screener_backfill'];
      }
    } else {
      researchData.warnings = [...(researchData.warnings || []), 'synthetic_screener_row'];
    }
    console.log('[V2 RESEARCH EARNINGS]', {
      symbol,
      next_date: researchData.earnings?.next?.report_date || null,
      source: researchData.earnings?.next?.report_date || researchData.earnings?.latest?.report_date ? 'database_or_fallback' : 'none',
    });

    return res.json({
      success: true,
      status: 'ok',
      source: 'database',
      data_confidence: researchData.data_confidence ?? 0,
      data_confidence_label: researchData.data_confidence_label || 'LOW',
      data_quality_label: researchData.data_quality_label || researchData.data_confidence_label || 'LOW',
      data: {
        ...emptyResearchData(symbol),
        ...researchData,
      },
      meta: {
        response_ms: Date.now() - startedAt,
        fallback: false,
        reason: null,
      },
    });
  } catch (error) {
    console.warn('[RESEARCH] route failure', { symbol, error: error.message });
    return res.json({
      success: true,
      status: 'ok',
      source: 'database',
      data_confidence: 0,
      data_confidence_label: 'LOW',
      data_quality_label: 'LOW',
      data: {
        ...emptyResearchData(symbol),
        screener: null,
        narrative: null,
        warnings: ['route_failure'],
      },
      meta: {
        response_ms: Date.now() - startedAt,
        fallback: true,
        reason: 'timeout',
      },
    });
  }
});

module.exports = router;