const express = require('express');
const { pool } = require('../db/pg');
const authMiddleware = require('../middleware/auth');

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

    const source_tag = detectSource(sender, subject);
    const receivedTs = received_at ? new Date(received_at) : new Date();

    const { rows } = await pool.query(
      `INSERT INTO intelligence_emails
         (sender, subject, received_at, raw_text, raw_html, source_tag)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, received_at, source_tag`,
      [sender, subject, receivedTs, raw_text, raw_html, source_tag]
    );

    const row = rows[0];
    console.log(JSON.stringify({
      event: 'INTEL_EMAIL_INGESTED',
      id: row.id,
      source_tag: row.source_tag,
      received_at: row.received_at,
      sender,
      subject,
    }));

    res.json({ ok: true, id: row.id, source_tag: row.source_tag, received_at: row.received_at });
  } catch (err) {
    console.error('[intelligence] email-ingest error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/intelligence/list — last 50 entries, JWT protected
router.get('/api/intelligence/list', authMiddleware, async (req, res) => {
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
      LIMIT 50
    `);
    res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[intelligence] list error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
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
