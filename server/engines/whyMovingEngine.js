const { queryWithTimeout } = require('../db/pg');

const DRIVER = {
  EARNINGS: 'EARNINGS',
  NEWS: 'NEWS',
  VOLUME: 'VOLUME',
  TECHNICAL_BREAKOUT: 'TECHNICAL_BREAKOUT',
  TECHNICAL_BREAKDOWN: 'TECHNICAL_BREAKDOWN',
  MACRO_SECTOR: 'MACRO_SECTOR',
  NO_DRIVER: 'NO_DRIVER',
};

const HIGH_IMPACT_KEYWORDS = [
  { pattern: /(earnings|guidance|eps|revenue|miss|beat|raises|cuts outlook)/i, score: 4 },
  { pattern: /(upgrade|downgrade|price target|initiates|outperform|underperform)/i, score: 3 },
  { pattern: /(fda|approval|clinical|phase\s?[123]|trial|hold|drug)/i, score: 4 },
  { pattern: /(merger|acquisition|buyout|partnership|contract|deal|joint venture)/i, score: 3 },
  { pattern: /(probe|lawsuit|sec|recall|delivery|factory|production|cfo|ceo)/i, score: 2 },
];

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function toIsoDate(value) {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function hoursFromNow(value) {
  const iso = toIsoDate(value);
  if (!iso) return null;
  return (Date.parse(iso) - Date.now()) / 3600000;
}

function hoursSince(value) {
  const iso = toIsoDate(value);
  if (!iso) return null;
  return (Date.now() - Date.parse(iso)) / 3600000;
}

function priceLabel(value) {
  const numeric = toNumber(value);
  if (numeric === null) return 'unavailable';
  return `$${numeric.toFixed(2)}`;
}

function normalizeSentiment(value) {
  const sentiment = String(value || '').trim().toLowerCase();
  if (sentiment === 'bullish' || sentiment === 'positive') return 'BULLISH';
  if (sentiment === 'bearish' || sentiment === 'negative') return 'BEARISH';
  return 'NEUTRAL';
}

function keywordBias(headline) {
  const text = String(headline || '').toLowerCase();
  const bullishHits = ['beat', 'raises', 'upgrade', 'approval', 'partnership', 'contract', 'buyout', 'outperform', 'growth'];
  const bearishHits = ['miss', 'cuts', 'downgrade', 'probe', 'lawsuit', 'recall', 'delay', 'underperform', 'misses'];
  const bullish = bullishHits.some((token) => text.includes(token));
  const bearish = bearishHits.some((token) => text.includes(token));

  if (bullish && !bearish) return 'BULLISH';
  if (bearish && !bullish) return 'BEARISH';
  return 'NEUTRAL';
}

function normalizeHeadlineText(value) {
  return String(value || '').trim().toLowerCase();
}

function extractCompanyTokens(companyName) {
  const ignored = new Set(['inc', 'corp', 'corporation', 'company', 'co', 'holdings', 'holding', 'group', 'plc', 'ltd', 'limited', 'class']);

  return normalizeHeadlineText(companyName)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !ignored.has(token));
}

function headlineMatchesSymbolContext(symbol, companyName, headline) {
  const normalizedHeadline = normalizeHeadlineText(headline);
  if (!normalizedHeadline) {
    return false;
  }

  const normalizedSymbol = normalizeSymbol(symbol).toLowerCase();
  if (normalizedSymbol && normalizedHeadline.includes(normalizedSymbol)) {
    return true;
  }

  const companyTokens = extractCompanyTokens(companyName);
  if (!companyTokens.length) {
    return false;
  }

  return companyTokens.some((token) => normalizedHeadline.includes(token));
}

function scoreHeadlineImpact(headline) {
  const text = String(headline || '').trim();
  if (!text) {
    return 0;
  }

  return HIGH_IMPACT_KEYWORDS.reduce((score, rule) => {
    return rule.pattern.test(text) ? score + rule.score : score;
  }, 0);
}

function defaultPayload(summary) {
  return {
    driver: DRIVER.NO_DRIVER,
    summary: summary || 'No earnings within 48 hours, no high-impact news, RVOL is below 2.0, and no confirmed breakout or breakdown is present.',
    tradeability: 'LOW',
    confidence_score: 20,
    bias: 'NEUTRAL',
    what_to_do: 'DO NOT TRADE. Wait for a confirmed catalyst or RVOL above 2.0.',
    what_to_avoid: 'Do not build a position off low-volume drift or recycled headlines.',
    setup: 'No valid setup.',
    trade_plan: null,
    action: 'DO NOT TRADE',
  };
}

async function loadMetrics(symbol) {
  if (!symbol) return null;

  const result = await queryWithTimeout(
    `SELECT symbol, price, change_percent, gap_percent, relative_volume, volume, avg_volume_30d,
            atr, rsi, vwap, previous_high, previous_close, updated_at
     FROM market_metrics
     WHERE symbol = $1
     LIMIT 1`,
    [symbol],
    {
      timeoutMs: 1200,
      label: 'why_moving.metrics',
      maxRetries: 0,
    }
  ).catch(() => ({ rows: [] }));

  const row = result.rows?.[0] || null;
  if (!row) return null;

  return {
    symbol,
    price: toNumber(row.price),
    change_percent: toNumber(row.change_percent),
    gap_percent: toNumber(row.gap_percent),
    relative_volume: toNumber(row.relative_volume),
    volume: toNumber(row.volume),
    avg_volume_30d: toNumber(row.avg_volume_30d),
    atr: toNumber(row.atr),
    rsi: toNumber(row.rsi),
    vwap: toNumber(row.vwap),
    previous_high: toNumber(row.previous_high),
    previous_close: toNumber(row.previous_close),
    updated_at: row.updated_at || null,
  };
}

async function loadNews(symbol) {
  if (!symbol) return [];

  const result = await queryWithTimeout(
    `SELECT symbol,
            COALESCE(title, headline) AS headline,
            sentiment,
            news_score,
            COALESCE(provider, source, 'news') AS source,
            published_at
     FROM news_articles
     WHERE symbol = $1
       AND COALESCE(published_at, created_at, NOW()) >= NOW() - INTERVAL '48 hours'
     ORDER BY COALESCE(published_at, created_at, NOW()) DESC
     LIMIT 8`,
    [symbol],
    {
      timeoutMs: 1200,
      label: 'why_moving.news',
      maxRetries: 0,
    }
  ).catch(() => ({ rows: [] }));

  return (result.rows || []).map((row) => ({
    symbol,
    headline: String(row.headline || '').trim(),
    sentiment: normalizeSentiment(row.sentiment),
    news_score: toNumber(row.news_score),
    source: String(row.source || 'news').trim() || 'news',
    published_at: row.published_at || null,
  })).filter((row) => row.headline);
}

async function loadCatalysts(symbol) {
  if (!symbol) return [];

  const result = await queryWithTimeout(
    `SELECT symbol, catalyst_type, headline, sentiment, published_at
     FROM trade_catalysts
     WHERE symbol = $1
       AND published_at >= NOW() - INTERVAL '48 hours'
     ORDER BY published_at DESC
     LIMIT 6`,
    [symbol],
    {
      timeoutMs: 1200,
      label: 'why_moving.catalysts',
      maxRetries: 0,
    }
  ).catch(() => ({ rows: [] }));

  return (result.rows || []).map((row) => ({
    symbol,
    catalyst_type: String(row.catalyst_type || '').trim().toUpperCase() || 'OTHER',
    headline: String(row.headline || '').trim(),
    sentiment: normalizeSentiment(row.sentiment),
    published_at: row.published_at || null,
  })).filter((row) => row.headline);
}

function nearestEarningsDriver(data) {
  const nextHours = hoursFromNow(data?.earnings?.next?.date);
  if (nextHours !== null && nextHours >= -6 && nextHours <= 48) {
    const edgeLabel = String(data?.earningsEdge?.edgeLabel || data?.earningsEdge?.edge_label || 'NO_EDGE').trim();
    const directionalBias = String(data?.earningsEdge?.directionalBias || data?.earningsEdge?.directional_bias || 'MIXED').toUpperCase();
    const expectedMove = toNumber(data?.earnings?.next?.expected_move_percent);
    const bias = directionalBias === 'BULLISH' ? 'BULLISH' : directionalBias === 'BEARISH' ? 'BEARISH' : 'NEUTRAL';

    return {
      driver: DRIVER.EARNINGS,
      bias,
      setup: bias === 'BEARISH' ? 'Pre-earnings risk reduction' : 'Pre-earnings directional positioning',
      summary: `Earnings is the active driver because the next report is within ${Math.max(0, Math.round(nextHours))} hours and the engine has ${edgeLabel} context with expected move ${expectedMove !== null ? `${expectedMove.toFixed(2)}%` : 'unavailable'}.`,
      what_to_do: bias === 'BEARISH'
        ? 'Only take short-side continuation if price fails to hold the pre-event range after the open.'
        : 'Only take long-side continuation if price holds the event range and volume expands after the open.',
      what_to_avoid: 'Do not front-run the report with size before the event window is confirmed on tape.',
      base_confidence: 82,
    };
  }

  const recentHistory = Array.isArray(data?.earnings?.history) ? data.earnings.history[0] : null;
  const recentHours = hoursSince(recentHistory?.date);
  if (recentHistory && recentHours !== null && recentHours <= 48) {
    const move = toNumber(recentHistory.post_move_percent ?? recentHistory.actual_move_percent ?? recentHistory.actualMove);
    const beat = typeof recentHistory.beat === 'boolean'
      ? recentHistory.beat
      : (() => {
          const actual = toNumber(recentHistory.eps_actual ?? recentHistory.epsActual);
          const estimate = toNumber(recentHistory.eps_estimate ?? recentHistory.epsEstimated);
          return actual !== null && estimate !== null ? actual > estimate : null;
        })();
    const bias = move !== null ? (move > 0 ? 'BULLISH' : move < 0 ? 'BEARISH' : 'NEUTRAL') : beat === true ? 'BULLISH' : beat === false ? 'BEARISH' : 'NEUTRAL';

    return {
      driver: DRIVER.EARNINGS,
      bias,
      setup: bias === 'BEARISH' ? 'Post-earnings downside continuation' : 'Post-earnings continuation',
      summary: `Earnings is the active driver because the last report is still inside the 48-hour reaction window and the stock has already moved ${move !== null ? `${move.toFixed(2)}%` : '0.00%'} since the release.`,
      what_to_do: bias === 'BEARISH'
        ? 'Favor continuation only if the stock stays below the post-event pivot and cannot reclaim prior close.'
        : 'Favor continuation only if the stock stays above the post-event pivot and holds the first pullback.',
      what_to_avoid: 'Do not fade the first clean post-earnings trend unless the move fully fails back through prior close.',
      base_confidence: 86,
    };
  }

  return null;
}

function highImpactNewsDriver(data) {
  const symbol = normalizeSymbol(data?.symbol || data?.profile?.symbol);
  const companyName = data?.profile?.company_name || null;
  const combined = [
    ...(Array.isArray(data?.catalysts) ? data.catalysts : []).map((item) => ({
      headline: item.headline,
      sentiment: item.sentiment,
      source: item.catalyst_type || 'catalyst',
      published_at: item.published_at,
      impact_score: scoreHeadlineImpact(item.headline) + 2,
      relevant: headlineMatchesSymbolContext(symbol, companyName, item.headline),
    })),
    ...(Array.isArray(data?.news) ? data.news : []).map((item) => ({
      headline: item.headline,
      sentiment: item.sentiment,
      source: item.source || 'news',
      published_at: item.published_at,
      impact_score: Math.max(scoreHeadlineImpact(item.headline), Math.round((toNumber(item.news_score) || 0) * 3)),
      relevant: headlineMatchesSymbolContext(symbol, companyName, item.headline),
    })),
  ]
    .filter((item) => item.headline && item.relevant)
    .sort((left, right) => {
      const leftScore = Number(left.impact_score || 0);
      const rightScore = Number(right.impact_score || 0);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return Date.parse(String(right.published_at || 0)) - Date.parse(String(left.published_at || 0));
    });

  const top = combined[0] || null;
  if (!top || Number(top.impact_score || 0) < 3) {
    return null;
  }

  const change = toNumber(data?.metrics?.change_percent) || toNumber(data?.price?.change_percent) || 0;
  const headlineBias = keywordBias(top.headline);
  const bias = top.sentiment !== 'NEUTRAL'
    ? top.sentiment
    : headlineBias !== 'NEUTRAL'
      ? headlineBias
      : change > 0
        ? 'BULLISH'
        : change < 0
          ? 'BEARISH'
          : 'NEUTRAL';
  const normalizedBias = bias === 'BULLISH' ? 'BULLISH' : bias === 'BEARISH' ? 'BEARISH' : 'NEUTRAL';

  return {
    driver: DRIVER.NEWS,
    bias: normalizedBias,
    setup: normalizedBias === 'BEARISH' ? 'Headline-driven downside continuation' : 'Headline-driven continuation',
    summary: `High-impact news is the active driver because the latest actionable headline is "${top.headline}" and it scores above the engine impact threshold.`,
    what_to_do: normalizedBias === 'BEARISH'
      ? 'Trade only if price stays below the headline reaction zone and sellers control the first bounce.'
      : 'Trade only if price holds the headline reaction zone and buyers defend the first pullback.',
    what_to_avoid: 'Do not trade recycled or opinion headlines without price confirmation in the current session.',
    base_confidence: 74,
  };
}

function volumeDriver(data) {
  const rvol = toNumber(data?.metrics?.relative_volume);
  const change = toNumber(data?.metrics?.change_percent) || 0;
  if (rvol === null || rvol <= 2) {
    return null;
  }

  const bias = change > 0 ? 'BULLISH' : change < 0 ? 'BEARISH' : 'NEUTRAL';
  return {
    driver: DRIVER.VOLUME,
    bias,
    setup: bias === 'BEARISH' ? 'High-RVOL downside expansion' : 'High-RVOL continuation',
    summary: `Volume is the active driver because RVOL is ${rvol.toFixed(2)}x, which is above the 2.0 trigger even without a stronger earnings or news catalyst.`,
    what_to_do: bias === 'BEARISH'
      ? 'Trade only if the stock keeps making lower highs while RVOL stays above 2.0.'
      : 'Trade only if the stock keeps making higher lows while RVOL stays above 2.0.',
    what_to_avoid: 'Do not chase volume alone if RVOL drops back under 2.0 or price loses trend structure.',
    base_confidence: 68,
  };
}

function technicalDriver(data) {
  const metrics = data?.metrics || {};
  const price = toNumber(metrics.price);
  const change = toNumber(metrics.change_percent);
  const gap = toNumber(metrics.gap_percent);
  const previousClose = toNumber(metrics.previous_close);
  const previousHigh = toNumber(metrics.previous_high);
  const rvol = toNumber(metrics.relative_volume) || 0;

  if (price !== null && previousHigh !== null && price > previousHigh && (change || 0) >= 2) {
    return {
      driver: DRIVER.TECHNICAL_BREAKOUT,
      bias: 'BULLISH',
      setup: 'Confirmed breakout',
      summary: `Technical breakout is the active driver because price ${priceLabel(price)} is above the prior high ${priceLabel(previousHigh)} with positive expansion of ${(change || 0).toFixed(2)}%.`,
      what_to_do: 'Trade only if price continues to hold above the broken level and does not immediately fail back below prior high.',
      what_to_avoid: 'Do not buy a breakout that instantly falls back under the trigger level.',
      base_confidence: rvol >= 1.2 ? 72 : 63,
    };
  }

  if (gap !== null && gap <= -3 && (change || 0) <= -2 && previousClose !== null) {
    return {
      driver: DRIVER.TECHNICAL_BREAKDOWN,
      bias: 'BEARISH',
      setup: 'Gap-down breakdown',
      summary: `Technical breakdown is the active driver because the stock opened with a ${gap.toFixed(2)}% gap down and is still trading below the prior close ${priceLabel(previousClose)}.`,
      what_to_do: 'Trade only if the stock fails to reclaim prior close and sellers keep control of intraday resistance.',
      what_to_avoid: 'Do not short a breakdown after a full reclaim of prior close.',
      base_confidence: rvol >= 1.2 ? 74 : 66,
    };
  }

  if (previousClose !== null && price !== null && price < previousClose && (change || 0) <= -3.5) {
    return {
      driver: DRIVER.TECHNICAL_BREAKDOWN,
      bias: 'BEARISH',
      setup: 'Closing-price breakdown',
      summary: `Technical breakdown is the active driver because price ${priceLabel(price)} is below the prior close ${priceLabel(previousClose)} and the move is already ${(change || 0).toFixed(2)}%.`,
      what_to_do: 'Trade only if the stock stays below prior close and cannot reclaim the first bounce.',
      what_to_avoid: 'Do not add size into a breakdown if price retakes prior close.',
      base_confidence: 64,
    };
  }

  return null;
}

function macroSectorDriver(data) {
  const change = toNumber(data?.metrics?.change_percent) || toNumber(data?.price?.change_percent) || 0;
  const sectorTailwind = Boolean(data?.context?.sectorTailwind);
  const regimeBias = String(data?.context?.regimeBias || '').trim().toUpperCase();
  const rvol = toNumber(data?.metrics?.relative_volume) || 0;

  if (!sectorTailwind && !regimeBias) {
    return null;
  }

  if (Math.abs(change) < 1.5 && rvol < 1.5) {
    return null;
  }

  const bias = regimeBias.includes('AVOID') ? 'BEARISH' : change > 0 ? 'BULLISH' : change < 0 ? 'BEARISH' : 'NEUTRAL';
  return {
    driver: DRIVER.MACRO_SECTOR,
    bias,
    setup: bias === 'BEARISH' ? 'Macro-aligned weakness' : 'Sector-tailwind continuation',
    summary: `Macro/sector is the active driver because the market regime is ${String(data?.context?.regime || 'UNKNOWN')} and the stock sector alignment is ${sectorTailwind ? 'confirmed' : 'regime-led only'}.`,
    what_to_do: bias === 'BEARISH'
      ? 'Trade only if the stock keeps underperforming while the market regime stays risk-off.'
      : 'Trade only if the stock keeps outperforming with sector support still active.',
    what_to_avoid: 'Do not force a regime trade if the stock stops tracking its sector and market context.',
    base_confidence: sectorTailwind ? 61 : 54,
  };
}

function detectWhyMoving(data) {
  return nearestEarningsDriver(data)
    || highImpactNewsDriver(data)
    || volumeDriver(data)
    || technicalDriver(data)
    || macroSectorDriver(data)
    || {
      driver: DRIVER.NO_DRIVER,
      bias: 'NEUTRAL',
      setup: 'No valid setup.',
      summary: 'No earnings within 48 hours, no high-impact news, RVOL is below 2.0, and no confirmed breakout or breakdown is present.',
      what_to_do: 'DO NOT TRADE. Wait for a confirmed catalyst or RVOL above 2.0.',
      what_to_avoid: 'Do not build a position off low-volume drift or recycled headlines.',
      base_confidence: 20,
    };
}

function calculateTradeability(data) {
  const detection = data?.detection || detectWhyMoving(data);
  if (detection.driver === DRIVER.NO_DRIVER) {
    return {
      tradeability: 'LOW',
      confidence_score: 20,
      action: 'DO NOT TRADE',
    };
  }

  const rvol = toNumber(data?.metrics?.relative_volume) || 0;
  const absChange = Math.abs(toNumber(data?.metrics?.change_percent) || toNumber(data?.price?.change_percent) || 0);
  const earningsEdgeScore = toNumber(data?.earningsEdge?.edgeScore ?? data?.earningsEdge?.edge_score) || 0;
  const expectedMove = toNumber(data?.earnings?.next?.expected_move_percent);
  const sectorTailwind = Boolean(data?.context?.sectorTailwind);

  let confidenceScore = Number(detection.base_confidence || 50);
  if (rvol >= 2) confidenceScore += 10;
  else if (rvol >= 1.2) confidenceScore += 4;
  if (absChange >= 5) confidenceScore += 8;
  else if (absChange >= 2) confidenceScore += 4;
  if (earningsEdgeScore >= 7) confidenceScore += 6;
  else if (earningsEdgeScore >= 4) confidenceScore += 3;
  if (expectedMove !== null && expectedMove >= 5) confidenceScore += 4;
  if (sectorTailwind) confidenceScore += 3;

  confidenceScore = clamp(Math.round(confidenceScore), 0, 100);

  let tradeability = 'LOW';
  if (confidenceScore >= 78) tradeability = 'HIGH';
  else if (confidenceScore >= 55) tradeability = 'MEDIUM';

  return {
    tradeability,
    confidence_score: confidenceScore,
    action: tradeability === 'LOW' ? 'DO NOT TRADE' : 'TRADE WITH PLAN',
  };
}

function buildTradePlan(data) {
  const detection = data?.detection || detectWhyMoving(data);
  const tradeability = data?.tradeability || calculateTradeability({ ...data, detection });

  if (detection.driver === DRIVER.NO_DRIVER || tradeability.tradeability === 'LOW') {
    return null;
  }

  const price = toNumber(data?.metrics?.price) || toNumber(data?.price?.price);
  const atr = toNumber(data?.metrics?.atr) || toNumber(data?.price?.atr) || 0;
  if (price === null) {
    return null;
  }

  const stopDistance = atr > 0 ? atr * 0.5 : price * 0.015;
  const targetDistance = atr > 0 ? atr : price * 0.03;
  const bullish = detection.bias === 'BULLISH';
  const entry = price;
  const stop = bullish ? price - stopDistance : price + stopDistance;
  const target = bullish ? price + targetDistance : price - targetDistance;

  return {
    timeframe: detection.driver === DRIVER.EARNINGS ? 'event window to 2 sessions' : 'intraday to 2 sessions',
    entry: `Only enter ${bullish ? 'above' : 'below'} ${priceLabel(entry)} in the direction of the driver.`,
    stop: `${bullish ? 'Exit below' : 'Exit above'} ${priceLabel(stop)}.`,
    target: `First target ${priceLabel(target)}.`,
    invalidation: bullish
      ? `Invalidate the setup if price loses ${priceLabel(stop)} or RVOL collapses below 1.0.`
      : `Invalidate the setup if price reclaims ${priceLabel(stop)} or RVOL collapses below 1.0.`,
  };
}

async function generateWhyMovingPayload(data) {
  const symbol = normalizeSymbol(data?.symbol || data?.profile?.symbol);
  const [metrics, news, catalysts] = await Promise.all([
    data?.metrics ? Promise.resolve(data.metrics) : loadMetrics(symbol),
    Array.isArray(data?.news) ? Promise.resolve(data.news) : loadNews(symbol),
    Array.isArray(data?.catalysts) ? Promise.resolve(data.catalysts) : loadCatalysts(symbol),
  ]);

  const enriched = {
    ...data,
    symbol,
    metrics,
    news,
    catalysts,
  };

  const detection = detectWhyMoving(enriched);
  const tradeability = calculateTradeability({ ...enriched, detection });
  const tradePlan = buildTradePlan({ ...enriched, detection, tradeability });

  if (detection.driver === DRIVER.NO_DRIVER) {
    return defaultPayload(detection.summary);
  }

  return {
    driver: detection.driver,
    summary: detection.summary,
    tradeability: tradeability.tradeability,
    confidence_score: tradeability.confidence_score,
    bias: detection.bias,
    what_to_do: detection.what_to_do,
    what_to_avoid: detection.what_to_avoid,
    setup: detection.setup,
    trade_plan: tradePlan,
    action: tradeability.action,
  };
}

module.exports = {
  detectWhyMoving,
  calculateTradeability,
  buildTradePlan,
  generateWhyMovingPayload,
};