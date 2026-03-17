const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { generateChartSnapshot } = require('./chartSnapshotEngine');
const { generateMorningNarrative } = require('../services/mcpClient');
const { generateMarketNarrative } = require('../engines/marketNarrativeEngine');
const { generateMarketStory } = require('../engines/marketStoryEngine');
const { getStocksInPlay } = require('../engines/stocksInPlayEngine');

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
    WITH radar AS (
      SELECT DISTINCT ON (symbol)
        symbol,
        beacon_probability,
        expected_move,
        catalyst AS catalyst_headline,
        setup_reasoning,
        confidence_score,
        created_at
      FROM institutional_radar_signals
      ORDER BY symbol, created_at DESC
    ),
    stream AS (
      SELECT DISTINCT ON (symbol)
        symbol,
        strategy_name,
        setup_type,
        confidence AS stream_confidence,
        rationale,
        created_at
      FROM opportunity_stream
      ORDER BY symbol, created_at DESC
    ),
    prices AS (
      SELECT DISTINCT ON (symbol)
        symbol,
        close AS price
      FROM intraday
      ORDER BY symbol, timestamp DESC
    )
    SELECT
      r.symbol,
      r.beacon_probability,
      r.expected_move,
      r.catalyst_headline,
      r.setup_reasoning,
      r.confidence_score,
      s.strategy_name,
      s.setup_type,
      s.stream_confidence,
      s.rationale,
      p.price
    FROM radar r
    LEFT JOIN stream s USING (symbol)
    LEFT JOIN prices p USING (symbol)
    WHERE r.beacon_probability IS NOT NULL
      AND r.expected_move IS NOT NULL
      AND p.price IS NOT NULL
    ORDER BY r.beacon_probability DESC, r.expected_move DESC
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

  const intradayRows = await queryWithTimeout(
    `SELECT symbol, close AS price
     FROM (
       SELECT symbol, close, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY timestamp DESC) AS rn
       FROM intraday
       WHERE symbol = ANY($1)
     ) t
     WHERE rn = 1`,
    [symbols],
    { timeoutMs: 6000, label: 'email.beacon_brief.market_snapshot.intraday', maxRetries: 0 }
  ).then((r) => r.rows || []).catch(() => []);

  const bySymbol = new Map((intradayRows || []).map((row) => [String(row.symbol || '').toUpperCase(), toNumber(row.price)]));
  const missingAfterPrimary = symbols.filter((sym) => !Number.isFinite(bySymbol.get(sym)));

  if (missingAfterPrimary.length) {
    const quoteRows = await queryWithTimeout(
      `SELECT symbol, COALESCE(price, close, last) AS price
       FROM market_quotes
       WHERE symbol = ANY($1)`,
      [missingAfterPrimary],
      { timeoutMs: 5000, label: 'email.beacon_brief.market_snapshot.quotes', maxRetries: 0 }
    ).then((r) => r.rows || []).catch(() => []);

    for (const row of quoteRows) {
      const sym = String(row.symbol || '').toUpperCase();
      const p = toNumber(row.price);
      if (Number.isFinite(p)) bySymbol.set(sym, p);
    }
  }

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
       tu.symbol,
       COALESCE(q.price, m.price, 0) AS price,
       COALESCE(
         ((COALESCE(q.price, m.price, 0) - COALESCE(q.previous_close, m.previous_close, m.prev_close, 0)) / NULLIF(COALESCE(q.previous_close, m.previous_close, m.prev_close, 0), 0)) * 100,
         q.change_percent,
         m.change_percent,
         0
       ) AS move,
       COALESCE(m.volume, q.volume, 0) AS volume,
       COALESCE(q.sector, 'Unknown') AS sector,
       COALESCE(m.relative_volume, 0) AS relative_volume
     FROM tradable_universe tu
     LEFT JOIN market_quotes q ON q.symbol = tu.symbol
     LEFT JOIN market_metrics m ON m.symbol = tu.symbol
     WHERE COALESCE(q.price, m.price, 0) > 2
       AND COALESCE(m.volume, q.volume, 0) > 200000
     ORDER BY ABS(COALESCE(
                ((COALESCE(q.price, m.price, 0) - COALESCE(q.previous_close, m.previous_close, m.prev_close, 0)) / NULLIF(COALESCE(q.previous_close, m.previous_close, m.prev_close, 0), 0)) * 100,
                q.change_percent,
                m.change_percent,
                0
              )) DESC,
              COALESCE(m.relative_volume, 0) DESC
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
    themes.push(`${sector} leadership`);
  }

  return themes;
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
    probabilityContext: 'Historical performance data building',
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
  const [setups, market, stocksInPlayRaw, topMoversRaw] = await Promise.all([
    getTopSetups(limit),
    getMarketSnapshot(),
    getStocksInPlay().catch(() => []),
    getTopMovers().catch(() => []),
  ]);

  let stocksInPlay = Array.isArray(stocksInPlayRaw) ? stocksInPlayRaw : [];

  const enriched = await Promise.all(setups.map(async (row) => {
    const snapshot = await generateChartSnapshot(row.symbol);
    return {
      ...row,
      chartUrl: snapshot.imageUrl,
      chartSource: snapshot.source,
      why_moving: row.catalyst_headline || row.rationale || 'Momentum and catalyst alignment detected.',
      why_tradeable: row.setup_reasoning || row.setup_type || row.strategy_name || 'A+ setup quality from institutional scanner',
      how_to_trade: `Focus on ${row.strategy_name || 'breakout continuation'} with disciplined risk control.`,
      tradePlan: buildTradePlan(row),
    };
  }));

  logger.info('[EMAIL_BEACON_BRIEF] generated payload', {
    setupCount: enriched.length,
    symbols: enriched.map((row) => row.symbol),
  });

  const narrative = await generateMorningNarrative({ market, setups: enriched }).catch(() => ({
    overview: 'Market tone is mixed; focus on conviction signals and liquidity confirmation.',
    risk: 'Risk remains elevated around macro headlines and opening volatility.',
    catalysts: [],
    watchlist: enriched.map((row) => row.symbol).slice(0, 8),
    _meta: { source: 'fallback' },
  }));

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
    const momentumCandidate = await buildMomentumCandidateFromMover(topMovers[0]);
    if (momentumCandidate) {
      stocksInPlay = [momentumCandidate];
    }
  }

  const radarThemes = generateRadarThemes(topMovers).slice(0, 4);

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
    : ['Market leadership rotation'];

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
      probabilityContext: 'Historical performance data building',
      news: { headline: 'No momentum headline available', url: null },
      narrative: {
        whyMoving: 'Momentum snapshot currently building from live market feeds.',
        whyTradeable: 'Scanner confidence will improve as intraday participation builds.',
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
    fallbackMessage: hasSetups ? null : 'Market conditions currently lack high probability setups.',
  };

  // Debug payload shape used by the email template.
  console.log('Beacon payload:', payload);

  return payload;
}

module.exports = {
  generateBeaconMorningPayload,
};
