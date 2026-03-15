const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { generateChartSnapshot } = require('./chartSnapshotEngine');
const { generateMorningNarrative } = require('../services/mcpClient');

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
  const sql = `
    SELECT symbol, close AS price
    FROM (
      SELECT symbol, close, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY timestamp DESC) AS rn
      FROM intraday
      WHERE symbol IN ('SPY','QQQ','VIX')
    ) t
    WHERE rn = 1
  `;

  const { rows } = await queryWithTimeout(sql, [], {
    timeoutMs: 6000,
    label: 'email.beacon_brief.market_snapshot',
    maxRetries: 0,
  }).catch(() => ({ rows: [] }));

  const bySymbol = Object.fromEntries((rows || []).map((row) => [row.symbol, toNumber(row.price)]));
  return {
    spy: bySymbol.SPY,
    qqq: bySymbol.QQQ,
    vix: bySymbol.VIX,
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
  const [setups, market] = await Promise.all([getTopSetups(limit), getMarketSnapshot()]);

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

  return {
    title: 'Beacon Morning Brief',
    preheader: 'Top OpenRange conviction setups for today',
    market,
    setups: enriched,
    narrative,
  };
}

module.exports = {
  generateBeaconMorningPayload,
};
