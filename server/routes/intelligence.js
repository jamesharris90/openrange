const express = require('express');
const { pool } = require('../db/pg');
const authMiddleware = require('../middleware/auth');
const { bridgeNewsletterEmailToIntelNews } = require('../services/emailIntelBridge');
const { ensureEarlyAccumulationTable } = require('../engines/earlyAccumulationEngine');
const { ensureEarlySignalOutcomesTable } = require('../engines/earlySignalOutcomeEngine');
const { ensureOrderFlowSignalsTable } = require('../engines/orderFlowImbalanceEngine');
const { ensureSectorMomentumTable } = require('../engines/sectorMomentumEngine');
const { runShortSqueezeEngine, listLatestSqueezeSignals } = require('../engines/shortSqueezeEngine');
const { runFlowDetectionEngine, listLatestFlowSignals } = require('../engines/flowDetectionEngine');
const { runMarketNarrativeEngine, getLatestMarketNarrative } = require('../engines/marketNarrativeEngine');

const router = express.Router();

const INTEL_KEY = process.env.INTEL_INGEST_KEY;

function requireIntelKey(req, res, next) {
  const provided = req.get('x-intel-key');
  if (!INTEL_KEY) {
    return res.status(503).json({ ok: false, error: 'INTEL_INGEST_KEY not configured on server' });
  }
  if (!provided || provided !== INTEL_KEY) {
    return res.status(401).json({ ok: false, error: 'Invalid or missing x-intel-key' });
  }
  next();
}

function detectSource(sender, subject) {
  if (!sender && !subject) return 'unknown';
  const combined = `${sender || ''} ${subject || ''}`.toLowerCase();
  if (combined.includes('briefing') || combined.includes('morning')) return 'briefing';
  if (combined.includes('alert') || combined.includes('breaking')) return 'alert';
  if (combined.includes('newsletter') || combined.includes('digest')) return 'newsletter';
  if (combined.includes('earnings') || combined.includes('report')) return 'earnings';
  if (combined.includes('analyst') || combined.includes('upgrade') || combined.includes('downgrade')) return 'analyst';
  return 'general';
}

function detectPublisherName(sender, subject) {
  const text = `${sender || ''} ${subject || ''}`.toLowerCase();
  if (text.includes('benzinga')) return 'Benzinga';
  if (text.includes('seeking alpha')) return 'Seeking Alpha';
  if (text.includes('briefing')) return 'Briefing.com';
  if (text.includes('marketwatch')) return 'MarketWatch';
  if (text.includes('bloomberg')) return 'Bloomberg';
  if (text.includes('reuters')) return 'Reuters';
  if (text.includes('cnbc')) return 'CNBC';
  if (text.includes('wsj') || text.includes('wall street journal')) return 'Wall Street Journal';
  if (text.includes('newsletter') || text.includes('digest')) return 'Newsletter';
  if (sender) return String(sender).split('@')[0] || sender;
  return 'Unknown publisher';
}

async function persistIntelligenceEmail({ sender, subject, received_at, raw_text, raw_html }) {
  const source_tag = detectSource(sender, subject);
  const source_name = detectPublisherName(sender, subject);
  const receivedTs = received_at ? new Date(received_at) : new Date();

  const { rows } = await pool.query(
    `INSERT INTO intelligence_emails
       (sender, subject, received_at, raw_text, raw_html, source_tag)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, received_at, source_tag`,
    [sender, subject, receivedTs, raw_text, raw_html, source_tag]
  );

  const row = rows[0];

  await bridgeNewsletterEmailToIntelNews({
    sender,
    subject,
    received_at: row?.received_at,
    raw_text,
    source_tag: row?.source_tag,
    source_name,
  });

  return {
    id: row.id,
    source_tag: row.source_tag,
    source_name,
    received_at: row.received_at,
  };
}

// GET /api/intelligence/ping — health check (requires key)
router.get('/api/intelligence/ping', requireIntelKey, (req, res) => {
  res.json({ ok: true, service: 'intelligence-ingest', ts: new Date().toISOString() });
});

// POST /api/intelligence/email-ingest — store inbound email intel
router.post('/api/intelligence/email-ingest', async (req, res) => {
  if (!process.env.INTEL_INGEST_KEY) {
    console.error("INTEL_INGEST_KEY missing from environment");
    return res.status(500).json({ error: "INTEL_INGEST_KEY not configured on server" });
  }

  const incomingKey = req.headers["x-intel-key"];

  if (!incomingKey) {
    return res.status(401).json({ error: "Missing x-intel-key header" });
  }

  if (incomingKey !== process.env.INTEL_INGEST_KEY) {
    return res.status(401).json({ error: "Unauthorized - invalid ingest key" });
  }

  try {
    const {
      sender = null,
      subject = null,
      received_at = null,
      raw_text = null,
      raw_html = null,
    } = req.body || {};

    if (!raw_text && !raw_html) {
      return res.status(400).json({ ok: false, error: 'raw_text or raw_html is required' });
    }

    const row = await persistIntelligenceEmail({ sender, subject, received_at, raw_text, raw_html });

    console.log(JSON.stringify({
      event: 'INTEL_EMAIL_INGESTED',
      id: row.id,
      source_tag: row.source_tag,
      received_at: row.received_at,
      sender,
      subject,
    }));

    res.json({ ok: true, id: row.id, source_tag: row.source_tag, source_name: row.source_name, received_at: row.received_at });
  } catch (err) {
    console.error('[intelligence] email-ingest error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/intelligence/resend-webhook — ingest Resend inbound payloads
router.post('/api/intelligence/resend-webhook', requireIntelKey, async (req, res) => {
  try {
    const sender = req.body?.from || req.body?.sender || null;
    const subject = req.body?.subject || null;
    const raw_text = req.body?.text || req.body?.raw_text || null;
    const raw_html = req.body?.html || req.body?.raw_html || null;
    const received_at = req.body?.received_at || req.body?.created_at || new Date().toISOString();

    if (!raw_text && !raw_html) {
      return res.status(400).json({ ok: false, error: 'text/html payload is required' });
    }

    const stored = await persistIntelligenceEmail({ sender, subject, received_at, raw_text, raw_html });
    return res.json({ ok: true, channel: 'resend', ...stored });
  } catch (error) {
    console.error('[intelligence] resend-webhook error:', error.message);
    return res.status(500).json({ ok: false, error: error.message || 'Failed to ingest resend payload' });
  }
});

// GET /api/intelligence/list — last 50 entries, JWT protected
router.get('/api/intelligence/list', authMiddleware, async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        subject,
        sender          AS "from",
        source_tag,
        received_at,
        LEFT(raw_text, 300) AS summary,
        NULL::numeric   AS sentiment_score,
        raw_text,
        processed
      FROM intelligence_emails
      ORDER BY received_at DESC
      LIMIT $1
    `, [limit]);
    res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[intelligence] list error:', {
      method: req.method,
      path: req.originalUrl,
      requestId: req.requestId,
      error: err?.message,
      stack: err?.stack,
    });
    res.status(500).json({
      ok: false,
      error: 'INTELLIGENCE_LIST_FAILED',
      message: 'Failed to load intelligence list',
      requestId: req.requestId,
      detail: err?.message || 'Unknown error',
    });
  }
});

// GET /api/intelligence/catalysts — latest catalysts by impact
router.get('/api/intelligence/catalysts', async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

  try {
    const { rows } = await pool.query(
      `SELECT
         symbol,
         catalyst_type,
         headline,
         source,
         sentiment,
         impact_score,
         published_at
       FROM news_catalysts
       ORDER BY impact_score DESC NULLS LAST, published_at DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[intelligence] catalysts error:', err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load catalysts' });
  }
});

// GET /api/intelligence/early-accumulation — latest experimental pressure signals
router.get('/api/intelligence/early-accumulation', async (req, res) => {
  try {
    await ensureEarlyAccumulationTable();
    await ensureEarlySignalOutcomesTable();

    const { rows } = await pool.query(
      `SELECT
         s.id,
         s.symbol,
         s.price,
         s.volume,
         s.avg_volume_30d,
         s.relative_volume,
         s.float_rotation,
         s.liquidity_surge,
         s.accumulation_score,
         s.pressure_level,
         s.sector,
         s.detected_at,
         o.max_move_percent
       FROM early_accumulation_signals s
       LEFT JOIN early_signal_outcomes o ON o.signal_id = s.id
       ORDER BY s.accumulation_score DESC NULLS LAST, s.detected_at DESC NULLS LAST
       LIMIT 20`
    );
    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[intelligence] early-accumulation error:', err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load early accumulation signals' });
  }
});

// GET /api/intelligence/order-flow — latest order-flow imbalance detections
router.get('/api/intelligence/order-flow', async (req, res) => {
  try {
    await ensureOrderFlowSignalsTable();

    const { rows } = await pool.query(
      `SELECT
         id,
         symbol,
         price,
         relative_volume,
         float_rotation,
         liquidity_surge,
         pressure_score,
         pressure_level,
         detected_at
       FROM order_flow_signals
       ORDER BY detected_at DESC NULLS LAST
       LIMIT 50`
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[intelligence] order-flow error:', err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load order-flow signals' });
  }
});

// GET /api/intelligence/sector-momentum — latest sector momentum table
router.get('/api/intelligence/sector-momentum', async (req, res) => {
  try {
    await ensureSectorMomentumTable();

    const { rows } = await pool.query(
      `SELECT
         sector,
         momentum_score,
         avg_gap,
         avg_rvol,
         top_symbol,
         updated_at
       FROM sector_momentum
       ORDER BY momentum_score DESC NULLS LAST
       LIMIT 30`
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[intelligence] sector-momentum error:', err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load sector momentum' });
  }
});

router.get('/api/intelligence/squeezes', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    let items = await listLatestSqueezeSignals(limit);
    if (!items.length) {
      await runShortSqueezeEngine();
      items = await listLatestSqueezeSignals(limit);
    }
    return res.json({ ok: true, items: items || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load squeeze signals', items: [] });
  }
});

router.get('/api/intelligence/flow', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    let items = await listLatestFlowSignals(limit);
    if (!items.length) {
      await runFlowDetectionEngine();
      items = await listLatestFlowSignals(limit);
    }
    return res.json({ ok: true, items: items || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load flow signals', items: [] });
  }
});

router.get('/api/stocks/in-play', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const { rows } = await pool.query(
      `SELECT id, symbol, gap_percent, rvol, catalyst, score, detected_at
       FROM stocks_in_play
       ORDER BY detected_at DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load stocks in play', items: [] });
  }
});

router.get('/api/intelligence/market-narrative', async (_req, res) => {
  try {
    let latest = await getLatestMarketNarrative();
    if (!latest) {
      await runMarketNarrativeEngine();
      latest = await getLatestMarketNarrative();
    }

    return res.json({
      ok: true,
      narrative: latest?.narrative || '',
      regime: latest?.regime || 'Neutral',
      created_at: latest?.created_at || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      narrative: '',
      regime: 'Neutral',
      created_at: null,
      error: err.message || 'Failed to load market narrative',
    });
  }
});

// PATCH /api/intelligence/:id/reviewed — mark as processed, JWT protected
router.patch('/api/intelligence/:id/reviewed', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE intelligence_emails SET processed = TRUE WHERE id = $1`,
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[intelligence] reviewed error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
