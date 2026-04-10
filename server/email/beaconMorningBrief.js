const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { generateChartSnapshot } = require('./chartSnapshotEngine');
const { generateMarketNarrative } = require('../engines/marketNarrativeEngine');
const { generateMarketStory } = require('../engines/marketStoryEngine');
const { buildNewsletterPayload } = require('../engines/newsletterEngine');

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeTickerRows(rows = []) {
  return rows
    .map((row) => {
      const beaconProbability = toNumber(row.beacon_probability);
      const expectedMove = toNumber(row.expected_move);
      const price = toNumber(row.price);
      return {
        ...row,
        symbol: String(row.symbol || '').toUpperCase().trim(),
        beacon_probability: beaconProbability,
        expected_move: expectedMove,
        price,
      };
    })
    .filter((row) => row.symbol && row.beacon_probability !== null && row.expected_move !== null && row.price !== null)
    .sort((a, b) => Number(b.beacon_probability) - Number(a.beacon_probability));
}

async function getTopSetups(limit = 5) {
  const sql = `
    WITH opportunity AS (
      SELECT DISTINCT ON (symbol)
        symbol,
        expected_move,
        why,
        how,
        change_percent,
        relative_volume,
        trade_class,
        created_at
      FROM opportunity_stream
      ORDER BY symbol, created_at DESC
    )
    SELECT
      h.symbol,
      COALESCE(t.score, h.score, 0) AS beacon_probability,
      COALESCE(o.expected_move, q.change_percent, 0) AS expected_move,
      COALESCE(nc.headline, t.signal_explanation, t.rationale, 'Momentum and catalyst alignment detected.') AS catalyst_headline,
      COALESCE(o.how, t.narrative, t.rationale, 'Wait for confirmation at key levels before entry.') AS setup_reasoning,
      COALESCE(t.confidence, h.confidence, 'Moderate') AS confidence_score,
      COALESCE(t.strategy, h.strategy, 'Momentum Continuation') AS strategy_name,
      COALESCE(t.setup_type, o.trade_class, 'Momentum Continuation') AS setup_type,
      COALESCE(o.why, t.rationale, t.signal_explanation, 'Momentum leadership detected.') AS rationale,
      COALESCE(q.price, t.entry_price, 0) AS price,
      COALESCE(q.relative_volume, o.relative_volume, 0) AS relative_volume,
      COALESCE(q.change_percent, o.change_percent, 0) AS change_percent,
      COALESCE(t.sector, q.sector, 'Unknown') AS sector,
      COALESCE(t.catalyst_type, nc.catalyst_type, 'unknown') AS catalyst_type
    FROM signal_hierarchy h
    LEFT JOIN trade_signals t ON t.symbol = h.symbol
    LEFT JOIN opportunity o ON o.symbol = h.symbol
    LEFT JOIN LATERAL (
      SELECT headline, catalyst_type
      FROM news_catalysts nc
      WHERE nc.symbol = h.symbol
      ORDER BY nc.published_at DESC NULLS LAST
      LIMIT 1
    ) nc ON TRUE
    LEFT JOIN market_quotes q ON q.symbol = h.symbol
    WHERE COALESCE(q.price, t.entry_price, 0) > 0
    ORDER BY h.hierarchy_rank DESC NULLS LAST, COALESCE(t.score, h.score, 0) DESC
    LIMIT $1
  `;

  const result = await queryWithTimeout(sql, [limit], {
    timeoutMs: 9000,
    label: 'email.beacon_brief.top_setups',
    maxRetries: 0,
  }).catch(() => ({ rows: [] }));

  return sanitizeTickerRows(result.rows || []);
}

async function getMarketSnapshot() {
  const symbols = ['SPY', 'QQQ', 'VIX'];

  const quoteRows = await queryWithTimeout(
    `SELECT symbol, COALESCE(price, previous_close, 0) AS price
     FROM market_quotes
     WHERE symbol = ANY($1)`,
    [symbols],
    { timeoutMs: 6000, label: 'email.beacon_brief.market_snapshot.quotes', maxRetries: 0 }
  ).then((r) => r.rows || []).catch(() => []);

  const bySymbol = new Map((quoteRows || []).map((row) => [String(row.symbol || '').toUpperCase(), toNumber(row.price)]));

  const missingAfterQuotes = symbols.filter((sym) => !Number.isFinite(bySymbol.get(sym)));
  if (missingAfterQuotes.length) {
    const dailyRows = await queryWithTimeout(
      `SELECT DISTINCT ON (symbol) symbol, close AS price
       FROM daily_ohlc
       WHERE symbol = ANY($1)
         AND date <= CURRENT_DATE - INTERVAL '1 day'
       ORDER BY symbol, date DESC`,
      [missingAfterQuotes],
      { timeoutMs: 5000, label: 'email.beacon_brief.market_snapshot.daily_ohlc', maxRetries: 0 }
    ).then((r) => r.rows || []).catch(() => []);

    for (const row of dailyRows) {
      const sym = String(row.symbol || '').toUpperCase();
      const p = toNumber(row.price);
      if (Number.isFinite(p)) bySymbol.set(sym, p);
    }
  }

  return {
    spy: Number.isFinite(bySymbol.get('SPY')) ? bySymbol.get('SPY') : 'N/A',
    qqq: Number.isFinite(bySymbol.get('QQQ')) ? bySymbol.get('QQQ') : 'N/A',
    vix: Number.isFinite(bySymbol.get('VIX')) ? bySymbol.get('VIX') : 'N/A',
  };
}

async function getTopMovers() {
  const { rows } = await queryWithTimeout(
    `SELECT
       symbol,
       COALESCE(price, 0) AS price,
       COALESCE(change_percent, 0) AS move,
       COALESCE(volume, 0) AS volume,
       COALESCE(sector, 'Unknown') AS sector,
       COALESCE(relative_volume, 0) AS relative_volume
     FROM market_quotes
     WHERE COALESCE(price, 0) > 2
       AND COALESCE(volume, 0) > 200000
     ORDER BY ABS(COALESCE(change_percent, 0)) DESC,
              COALESCE(relative_volume, 0) DESC,
              COALESCE(volume, 0) DESC
     LIMIT 5`,
    [],
    { timeoutMs: 7000, label: 'email.beacon_brief.top_movers', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return (rows || []).map((row) => ({
    symbol: String(row.symbol || '').toUpperCase(),
    price: toNumber(row.price),
    change: toNumber(row.move, 0),
    volume: toNumber(row.volume, 0),
    sector: row.sector || 'Unknown',
    relativeVolume: toNumber(row.relative_volume, 0),
  }));
}

function generateRadarThemes(movers = []) {
  const groups = new Map();
  for (const row of movers || []) {
    const sector = String(row.sector || 'Unknown').trim();
    if (!groups.has(sector)) groups.set(sector, 0);
    groups.set(sector, groups.get(sector) + 1);
  }

  const themes = [];
  for (const [sector, count] of groups.entries()) {
    if (count < 3) continue;
    const s = sector.toLowerCase();
    if (s.includes('semi') || s.includes('chip')) {
      themes.push('AI semiconductors');
    } else if (s.includes('biotech') || s.includes('health')) {
      themes.push('Small cap biotech');
    } else if (s.includes('energy')) {
      themes.push('Energy services');
    } else {
      themes.push(`${sector} leadership`);
    }
  }

  if (!themes.length && movers.length) {
    const sector = String(movers[0].sector || 'Market').trim();
    themes.push(sector.toLowerCase() === 'unknown' ? 'Speculative momentum leaders' : `${sector} leadership`);
  }

  return themes;
}

function uniqueStrings(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

async function buildMomentumCandidateFromMover(mover = {}) {
  const symbol = String(mover.symbol || '').toUpperCase();
  if (!symbol) return null;

  const snapshot = await generateChartSnapshot(symbol).catch(() => ({ imageUrl: null }));
  return {
    symbol,
    price: toNumber(mover.price),
    rvol: toNumber(mover.relativeVolume),
    relative_volume: toNumber(mover.relativeVolume),
    move: toNumber(mover.change),
    price_change_percent: toNumber(mover.change),
    setupType: 'Momentum Candidate',
    tradeScore: 70,
    grade: 'B',
    confidence: 'Moderate',
    strategyStats: {
      winRate: 0,
      avgMove: 0,
      avgDrawdown: 0,
      sampleSize: 0,
    },
    probabilityContext: 'Historical performance data unavailable',
    news: {
      headline: 'Momentum-led move with expanding participation',
      url: null,
    },
    sector: mover.sector || 'Unknown',
    narrative: {
      whyMoving: `${symbol} is showing broad momentum leadership on elevated participation.`,
      whyTradeable: `${symbol} is showing contextual relative strength versus peers in ${String(mover.sector || 'its').toLowerCase()} as liquidity expands.`,
      howToTrade: 'Wait for continuation above intraday consolidation before entering.',
      risk: 'Invalidation below intraday VWAP.',
      target: 'Trail into trend continuation with partials at 1R and 2R.',
    },
    chartImage: snapshot?.imageUrl || `https://finviz.com/chart.ashx?t=${encodeURIComponent(symbol)}`,
    chartUrl: snapshot?.imageUrl || `https://finviz.com/chart.ashx?t=${encodeURIComponent(symbol)}`,
    label: 'Momentum Candidate',
    stockOfTheDay: true,
  };
}

async function getSignalContextMap(symbols = []) {
  const normalizedSymbols = Array.from(new Set((symbols || []).map((symbol) => String(symbol || '').toUpperCase().trim()).filter(Boolean)));
  if (!normalizedSymbols.length) {
    return new Map();
  }

  const [quoteRows, opportunityRows] = await Promise.all([
    queryWithTimeout(
      `SELECT symbol, price, change_percent, relative_volume, volume, sector
       FROM market_quotes
       WHERE symbol = ANY($1)`,
      [normalizedSymbols],
      { timeoutMs: 7000, label: 'email.beacon_brief.signal_context.quotes', maxRetries: 0 }
    ).then((result) => result.rows || []).catch(() => []),
    queryWithTimeout(
      `SELECT DISTINCT ON (symbol)
         symbol,
         expected_move,
         change_percent,
         relative_volume,
         trade_class,
         why,
         how,
         created_at
       FROM opportunity_stream
       WHERE symbol = ANY($1)
       ORDER BY symbol, created_at DESC NULLS LAST`,
      [normalizedSymbols],
      { timeoutMs: 7000, label: 'email.beacon_brief.signal_context.opportunity', maxRetries: 0 }
    ).then((result) => result.rows || []).catch(() => []),
  ]);

  const opportunityMap = new Map(opportunityRows.map((row) => [String(row.symbol || '').toUpperCase(), row]));
  const contextMap = new Map();

  for (const symbol of normalizedSymbols) {
    const quote = quoteRows.find((row) => String(row.symbol || '').toUpperCase() === symbol) || null;
    const opportunity = opportunityMap.get(symbol) || null;
    contextMap.set(symbol, {
      price: toNumber(quote?.price, null),
      change_percent: toNumber(quote?.change_percent, toNumber(opportunity?.change_percent, toNumber(opportunity?.expected_move, null))),
      relative_volume: toNumber(quote?.relative_volume, toNumber(opportunity?.relative_volume, null)),
      sector: String(quote?.sector || '').trim() || String(opportunity?.sector || '').trim() || null,
      trade_class: String(opportunity?.trade_class || '').trim() || null,
      why: String(opportunity?.why || '').trim() || null,
      how: String(opportunity?.how || '').trim() || null,
    });
  }

  return contextMap;
}

async function buildSignalCandidate(signal = {}, index = 0, contextMap = new Map()) {
  const symbol = String(signal.symbol || '').toUpperCase().trim();
  if (!symbol) return null;

  const snapshot = await generateChartSnapshot(symbol).catch(() => ({ imageUrl: null }));
  const context = contextMap.get(symbol) || {};
  const price = toNumber(signal.entry_price, toNumber(context.price, null));
  const move = toNumber(context.change_percent, null);
  const relativeVolume = toNumber(context.relative_volume, null);
  const tradeScore = Math.max(55, Math.min(99, Math.round(toNumber(signal.score, 70))));
  const confidence = String(signal.confidence || 'B').trim();
  const grade = confidence.toUpperCase().slice(0, 2) || 'B';
  const strategy = String(signal.strategy || context.trade_class || 'Gap and Go').trim();
  const sector = String(signal.sector || context.sector || 'Unknown').trim() || 'Unknown';
  const catalyst = String(signal.catalyst || 'market structure').trim() || 'market structure';
  const tradePlan = buildTradePlan({ price });

  return {
    symbol,
    price,
    rvol: relativeVolume,
    relative_volume: relativeVolume,
    move,
    price_change_percent: move,
    setupType: strategy,
    tradeScore,
    grade,
    confidence,
    strategyStats: {
      winRate: null,
      avgMove: null,
      avgDrawdown: null,
      sampleSize: null,
    },
    probabilityContext: [
      `${index === 0 ? 'Primary' : 'Secondary'} hierarchy selection`,
      `Score: ${tradeScore}`,
      `Confidence: ${confidence}`,
      `Strategy: ${strategy}`,
    ].join('\n'),
    news: {
      headline: catalyst === 'unknown' ? `${symbol} is ranking highly on the live hierarchy feed.` : `${symbol} catalyst: ${catalyst}`,
      url: null,
    },
    sector,
    narrative: {
      whyMoving: catalyst === 'unknown'
        ? (context.why || `${symbol} is surfacing through the live hierarchy with strong relative ranking this morning.`)
        : `${symbol} is being driven by ${catalyst} while staying elevated in the hierarchy feed.`,
      whyTradeable: `${symbol} is on the priority watchlist because ${strategy.toLowerCase()} conditions are present with ${confidence} confidence.`,
      howToTrade: context.how || `Use ${strategy.toLowerCase()} rules and wait for confirmation through the opening range before committing size.`,
      risk: tradePlan.stop,
      target: tradePlan.targets,
    },
    chartImage: snapshot?.imageUrl || `https://finviz.com/chart.ashx?t=${encodeURIComponent(symbol)}`,
    chartUrl: snapshot?.imageUrl || `https://finviz.com/chart.ashx?t=${encodeURIComponent(symbol)}`,
    label: index === 0 ? 'Priority Watchlist' : 'Watchlist Candidate',
    stockOfTheDay: index === 0,
  };
}

function buildTradePlan(setup = {}) {
  const entry = setup.price ? `$${Number(setup.price).toFixed(2)} breakout confirmation` : 'Break above opening range high';
  const stop = setup.price ? `$${(Number(setup.price) * 0.985).toFixed(2)} invalidation` : 'Below VWAP / opening range low';
  const t1 = setup.price ? `$${(Number(setup.price) * 1.02).toFixed(2)}` : '1R objective';
  const t2 = setup.price ? `$${(Number(setup.price) * 1.04).toFixed(2)}` : '2R objective';
  return {
    entry,
    stop,
    targets: `${t1}, ${t2}`,
  };
}

async function generateBeaconMorningPayload(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 5), 8));
  const [setups, market, previewPayload, topMoversRaw] = await Promise.all([
    getTopSetups(limit),
    getMarketSnapshot(),
    buildNewsletterPayload().catch(() => ({ topSignals: [], topCatalysts: [], marketNarrative: null })),
    getTopMovers().catch(() => []),
  ]);

  const enriched = await Promise.all(setups.map(async (row) => {
    const snapshot = await generateChartSnapshot(row.symbol);
    const tradePlan = buildTradePlan(row);
    return {
      ...row,
      chartUrl: snapshot.imageUrl,
      chartSource: snapshot.source,
      why_moving: row.catalyst_headline || row.rationale || 'Momentum and catalyst alignment detected.',
      why_tradeable: row.setup_reasoning || row.setup_type || row.strategy_name || 'A+ setup quality from institutional scanner',
      how_to_trade: `Focus on ${row.strategy_name || 'breakout continuation'} with disciplined risk control.`,
      tradePlan,
      price_change_percent: toNumber(row.change_percent, toNumber(row.expected_move, 0)),
      relative_volume: toNumber(row.relative_volume, 0),
      tradeScore: toNumber(row.beacon_probability, 0),
      confidence: row.confidence_score || 'Moderate',
      setupType: row.setup_type || row.strategy_name || 'Momentum Continuation',
      sector: row.sector || 'Unknown',
      catalyst: row.catalyst_type || row.catalyst_headline || 'unknown',
      news: {
        headline: row.catalyst_headline || 'No catalyst summary available.',
        url: null,
      },
      narrative: {
        whyMoving: row.catalyst_headline || row.rationale || 'Momentum leadership detected.',
        whyTradeable: row.setup_reasoning || row.setup_type || 'Structure quality currently acceptable for active monitoring.',
        howToTrade: `Focus on ${row.strategy_name || 'breakout continuation'} with disciplined risk control.`,
        risk: tradePlan.stop,
        target: tradePlan.targets,
      },
      grade: String(row.confidence_score || 'B').toUpperCase().slice(0, 2),
      stockOfTheDay: false,
    };
  }));

  let stocksInPlay = enriched.map((row, index) => ({
    ...row,
    stockOfTheDay: index === 0,
  }));
  const previewSignals = Array.isArray(previewPayload?.topSignals) ? previewPayload.topSignals : [];

  if (!stocksInPlay.length && previewSignals.length) {
    const signalContextMap = await getSignalContextMap(previewSignals.slice(0, 4).map((signal) => signal.symbol));
    const signalCandidates = await Promise.all(previewSignals.slice(0, 4).map((signal, index) => buildSignalCandidate(signal, index, signalContextMap)));
    stocksInPlay = signalCandidates.filter(Boolean);
  }

  logger.info('[EMAIL_BEACON_BRIEF] generated payload', {
    setupCount: enriched.length,
    symbols: enriched.map((row) => row.symbol),
  });

  const narrative = {
    overview: String(previewPayload?.marketNarrative || 'Market tone is mixed; focus on conviction signals and liquidity confirmation.'),
    risk: enriched.length
      ? 'Focus on confirmation, opening liquidity, and disciplined invalidation levels.'
      : 'Risk posture neutral until stronger momentum and catalyst alignment returns.',
    catalysts: Array.isArray(previewPayload?.topCatalysts)
      ? uniqueStrings(previewPayload.topCatalysts.map((row) => `${row.symbol || 'N/A'} ${row.catalyst_type || 'catalyst'}`)).slice(0, 4)
      : [],
    watchlist: uniqueStrings([...enriched.map((row) => row.symbol), ...stocksInPlay.map((row) => row.symbol)]).slice(0, 8),
    _meta: { source: 'live-newsletter-payload' },
  };

  const fallbackMovers = (enriched || []).slice(0, 3).map((row) => ({
    symbol: row.symbol,
    price: row.price,
    change: row.expected_move,
    relativeVolume: null,
    sector: 'Unknown',
  }));

  const topMovers = (topMoversRaw || []).length
    ? topMoversRaw
    : ((stocksInPlay || []).map((row) => ({
      symbol: row.symbol,
      price: row.price,
      change: row.price_change_percent,
      relativeVolume: row.relative_volume,
      sector: row.sector || 'Unknown',
    })));

  if (!stocksInPlay.length && topMovers.length) {
    const moverCandidates = await Promise.all(topMovers.slice(0, 4).map((mover) => buildMomentumCandidateFromMover(mover)));
    stocksInPlay = moverCandidates.filter(Boolean).map((row, index) => ({
      ...row,
      stockOfTheDay: index === 0,
    }));
  }

  const watchlistSymbols = uniqueStrings(stocksInPlay.map((row) => row.symbol)).slice(0, 8);
  narrative.watchlist = watchlistSymbols;

  const previewThemes = Array.isArray(previewPayload?.sectorLeaders)
    ? previewPayload.sectorLeaders
        .map((row) => String(row?.sector || '').trim())
        .filter((sector) => sector && sector.toLowerCase() !== 'unknown')
        .map((sector) => `${sector} leadership`)
    : [];
  const radarThemes = uniqueStrings([...previewThemes, ...generateRadarThemes(topMovers)]).slice(0, 4);

  const overviewFromEngine = generateMarketNarrative({
    spy: market.spy,
    qqq: market.qqq,
    vix: market.vix,
    sectorMovers: (stocksInPlay || []).map((row) => ({ sector: row.sector })).filter((row) => row.sector),
    topMovers: topMovers.length ? topMovers : fallbackMovers,
  });

  const storyOverview = generateMarketStory({
    SPY: market.spy,
    QQQ: market.qqq,
    VIX: market.vix,
    topMovers: topMovers.length ? topMovers : fallbackMovers,
    radarThemes,
  });

  const marketContext = {
    spy: market.spy ?? 'N/A',
    qqq: market.qqq ?? 'N/A',
    vix: market.vix ?? 'N/A',
    overview: String(storyOverview || overviewFromEngine || narrative?.overview || 'No overview generated.'),
    risk: String(narrative?.risk || 'No risk summary generated.'),
    topMovers: Array.isArray(topMovers) && topMovers.length ? topMovers : fallbackMovers,
    radarThemes: Array.isArray(radarThemes) && radarThemes.length ? radarThemes : ['Market leadership rotation'],
  };

  const hasSetups = Array.isArray(stocksInPlay) && stocksInPlay.length > 0;

  const stockOfDay = (stocksInPlay || []).find((row) => row.stockOfTheDay)
    || (stocksInPlay || []).slice().sort((a, b) => Number(b.tradeScore || 0) - Number(a.tradeScore || 0))[0]
    || null;

  const secondary = (stocksInPlay || []).filter((row) => !stockOfDay || row.symbol !== stockOfDay.symbol);

  const guaranteedTopMovers = (marketContext.topMovers && marketContext.topMovers.length)
    ? marketContext.topMovers
    : [{ symbol: 'N/A', price: null, change: 0, relativeVolume: 0, sector: 'Unknown' }];

  const guaranteedRadarThemes = (marketContext.radarThemes && marketContext.radarThemes.length)
    ? marketContext.radarThemes
    : ['Priority watchlist rotation'];

  const guaranteedStockOfDay = stockOfDay
    || (await buildMomentumCandidateFromMover(guaranteedTopMovers[0]))
    || {
      symbol: 'N/A',
      price: null,
      rvol: 0,
      relative_volume: 0,
      move: 0,
      price_change_percent: 0,
      setupType: 'Momentum Candidate',
      tradeScore: 60,
      grade: 'C',
      confidence: 'Low',
      strategyStats: { winRate: 0, avgMove: 0, avgDrawdown: 0, sampleSize: 0 },
      probabilityContext: 'Historical performance data unavailable',
      news: { headline: 'No momentum headline available', url: null },
      narrative: {
        whyMoving: 'No momentum catalyst summary is available yet.',
        whyTradeable: 'Scanner confidence is limited until stronger price and volume confirmation appears.',
        howToTrade: 'Wait for liquidity confirmation before considering entries.',
        risk: 'Stand aside until price and volume confirmation appear.',
        target: 'Reassess once fresh momentum candidates are detected.',
      },
      chartImage: null,
      chartUrl: null,
      label: 'Momentum Candidate',
      stockOfTheDay: true,
    };

  const guaranteedSecondary = secondary.length ? secondary : [];

  const payload = {
    title: 'Beacon Morning Brief',
    preheader: 'Top OpenRange conviction setups for today',
    market,
    setups: enriched,
    narrative,
    marketContext: {
      ...marketContext,
      topMovers: guaranteedTopMovers,
      radarThemes: guaranteedRadarThemes,
    },
    stocksInPlay: Array.isArray(stocksInPlay) && stocksInPlay.length ? stocksInPlay : [guaranteedStockOfDay],
    stockOfDay: guaranteedStockOfDay,
    secondaryOpportunities: guaranteedSecondary,
    topMovers: guaranteedTopMovers,
    radarThemes: guaranteedRadarThemes,
    mode: enriched.length ? 'setup' : (stocksInPlay.length ? 'watchlist' : 'fallback'),
    fallbackMessage: hasSetups
      ? null
      : (stocksInPlay.length
        ? 'Live hierarchy signals are leading this morning, so this brief is prioritizing the strongest watchlist names while deeper setup scoring catches up.'
        : 'Market conditions currently lack high probability setups.'),
  };

  return payload;
}

module.exports = {
  generateBeaconMorningPayload,
};
