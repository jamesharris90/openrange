const express = require('express');
const { queryWithTimeout } = require('../db/pg');

const router = express.Router();

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function defaultSetups() {
  return [
    { name: 'VWAP reclaim', probability: 64 },
    { name: 'Momentum continuation', probability: 61 },
    { name: 'Breakout watch', probability: 56 },
  ];
}

function makePlaybook(symbols = []) {
  const names = symbols.slice(0, 2).join(' / ') || 'primary symbols';
  return {
    style: 'momentum continuation',
    trigger: `Watch for pullback to VWAP on ${names} with reclaim and rising volume.`,
    window: 'First 60 minutes of US open',
  };
}

function normalizeAffected(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v || '').toUpperCase().trim())
    .filter(Boolean)
    .map((symbol) => ({ symbol, intensity: 0.45 }));
}

function scoreBreakdownOrDefault(scoreBreakdown) {
  const b = scoreBreakdown || {};
  return {
    newsVolume: toNum(b.newsVolume, b.news_volume || 0.32),
    sentiment: toNum(b.sentiment, b.sentiment_strength || 0.18),
    clustering: toNum(b.clustering, b.ticker_clustering || 0.22),
    macroAlignment: toNum(b.macroAlignment, b.macro_alignment || 0.15),
    momentum: toNum(b.momentum, b.momentum_signal || 0.13),
  };
}

async function getByNumericId(id) {
  const { rows } = await queryWithTimeout(
    `SELECT
       i.id,
       i.symbol,
       i.headline,
       i.source,
       i.url,
       i.sentiment,
       i.published_at,
       i.narrative,
       i.score_breakdown,
       i.narrative_confidence,
       i.narrative_type,
       i.time_horizon,
       i.regime,
       i.detected_symbols
     FROM intel_news i
     WHERE i.id = $1
     LIMIT 1`,
    [id],
    { timeoutMs: 5000, label: 'routes.intel_details.by_id', maxRetries: 0 }
  );

  if (!rows.length) return null;
  const row = rows[0];

  return {
    id: row.id,
    title: row.headline,
    narrative: row.narrative || row.headline,
    score_breakdown: scoreBreakdownOrDefault(row.score_breakdown),
    data_sources: [{ type: 'headline', title: row.headline, url: row.url || null }],
    affected_tickers: normalizeAffected(row.detected_symbols || [row.symbol].filter(Boolean)),
    setups: defaultSetups(),
    confidence: toNum(row.narrative_confidence, 0.72),
    regime: row.regime || 'neutral',
    sector: row.symbol || 'Market',
    narrative_type: row.narrative_type || 'single stock',
    time_horizon: row.time_horizon || 'intraday',
    playbook: makePlaybook((row.detected_symbols || [row.symbol]).filter(Boolean)),
  };
}

async function getSectorDetail(sectorToken) {
  const { rows } = await queryWithTimeout(
    `SELECT narrative, regime, created_at
     FROM market_narratives
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1`,
    [],
    { timeoutMs: 5000, label: 'routes.intel_details.sector_narrative', maxRetries: 0 }
  );

  const raw = rows[0] || null;
  let parsed = [];
  try {
    parsed = raw?.narrative ? JSON.parse(raw.narrative) : [];
  } catch {
    parsed = [];
  }

  const pick = parsed.find((row) => String(row?.sector || '').toLowerCase() === sectorToken.toLowerCase()) || parsed[0] || {};
  const symbols = Array.isArray(pick?.affected_symbols) ? pick.affected_symbols : [];

  return {
    title: `${pick?.sector || sectorToken} Sector Narrative`,
    sector: pick?.sector || sectorToken,
    narrative: pick?.narrative || 'No narrative generated for this sector yet.',
    score_breakdown: scoreBreakdownOrDefault(pick?.score_breakdown),
    data_sources: [
      { type: 'sector momentum', title: `${pick?.sector || sectorToken} momentum snapshot`, url: null },
      { type: 'macro events', title: 'Regime context and top catalysts', url: null },
    ],
    affected_tickers: normalizeAffected(symbols),
    setups: defaultSetups(),
    confidence: toNum(pick?.confidence, 0.66),
    regime: raw?.regime || 'neutral',
    narrative_type: 'sector',
    time_horizon: 'swing',
    playbook: makePlaybook(symbols),
  };
}

async function getSignalDetail(symbol) {
  const normalized = String(symbol || '').toUpperCase();
  const [signalRes, newsRes] = await Promise.all([
    queryWithTimeout(
      `SELECT
         symbol,
         strategy,
         score,
         confidence,
         score_breakdown,
         narrative,
         catalyst_type,
         sector
       FROM trade_signals
       WHERE symbol = $1
       LIMIT 1`,
      [normalized],
      { timeoutMs: 5000, label: 'routes.intel_details.signal.signal', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT headline, source, url
       FROM intel_news
       WHERE symbol = $1
       ORDER BY published_at DESC NULLS LAST
       LIMIT 6`,
      [normalized],
      { timeoutMs: 5000, label: 'routes.intel_details.signal.news', maxRetries: 0 }
    ).catch(() => ({ rows: [] })),
  ]);

  const row = signalRes.rows[0] || {};
  return {
    title: `${normalized} Signal Intelligence`,
    sector: row?.sector || 'Market',
    narrative: row?.narrative || `${normalized} signal context derived from scoring and catalysts.`,
    score_breakdown: scoreBreakdownOrDefault(row?.score_breakdown),
    data_sources: (newsRes.rows || []).map((n) => ({ type: 'headline', title: n.headline, url: n.url || null })) ,
    affected_tickers: normalizeAffected([normalized]),
    setups: defaultSetups().map((s) => ({ ...s, probability: s.probability + (toNum(row?.score, 70) > 85 ? 6 : 0) })),
    confidence: toNum(row?.confidence, 0.68),
    regime: toNum(row?.score, 0) >= 90 ? 'bullish' : 'neutral',
    narrative_type: 'single stock',
    time_horizon: 'intraday',
    playbook: makePlaybook([normalized]),
  };
}

async function getNewsSymbolDetail(symbol) {
  const normalized = String(symbol || '').toUpperCase();
  const { rows } = await queryWithTimeout(
    `SELECT headline, source, url, sentiment
     FROM intel_news
     WHERE symbol = $1
     ORDER BY published_at DESC NULLS LAST
     LIMIT 8`,
    [normalized],
    { timeoutMs: 5000, label: 'routes.intel_details.news_symbol', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const sentimentScore = rows.reduce((acc, row) => {
    const s = String(row?.sentiment || '').toLowerCase();
    if (s === 'positive' || s === 'bullish') return acc + 1;
    if (s === 'negative' || s === 'bearish') return acc - 1;
    return acc;
  }, 0);

  return {
    title: `${normalized} Intel Feed`,
    sector: normalized,
    narrative: `${normalized} narrative synthesized from recent intelligence headlines and scoring factors.`,
    score_breakdown: scoreBreakdownOrDefault({
      newsVolume: 0.28 + Math.min(0.12, rows.length / 100),
      sentiment: 0.16 + (sentimentScore > 0 ? 0.05 : 0),
      clustering: 0.2,
      macroAlignment: 0.15,
      momentum: 0.12,
    }),
    data_sources: rows.map((row) => ({ type: 'headline', title: row.headline, url: row.url || null })),
    affected_tickers: normalizeAffected([normalized]),
    setups: defaultSetups(),
    confidence: 0.64,
    regime: sentimentScore > 0 ? 'bullish' : sentimentScore < 0 ? 'bearish' : 'neutral',
    narrative_type: 'single stock',
    time_horizon: 'intraday',
    playbook: makePlaybook([normalized]),
  };
}

router.get('/intel/details/:id', async (req, res) => {
  const token = String(req.params.id || '').trim();
  if (!token) {
    return res.status(400).json({ ok: false, error: 'id is required' });
  }

  try {
    const numericId = Number(token);
    if (Number.isFinite(numericId) && numericId > 0) {
      const detail = await getByNumericId(numericId);
      if (!detail) return res.status(404).json({ ok: false, error: 'Detail not found' });
      return res.json(detail);
    }

    if (token.startsWith('sector:')) {
      const sector = token.split(':')[1] || 'market';
      return res.json(await getSectorDetail(sector));
    }

    if (token.startsWith('signal:')) {
      const symbol = token.split(':')[1] || '';
      return res.json(await getSignalDetail(symbol));
    }

    if (token.startsWith('news:')) {
      const symbol = token.split(':')[1] || '';
      return res.json(await getNewsSymbolDetail(symbol));
    }

    return res.status(400).json({ ok: false, error: 'Unsupported detail token' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load intel details' });
  }
});

module.exports = router;
