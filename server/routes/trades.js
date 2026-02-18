const express = require('express');
const multer = require('multer');
const tradeService = require('../services/trades/tradeService');
const tradeModel = require('../services/trades/tradeModel');
const { parsePdf, parseExcel, parseText } = require('../services/trades/pdfParser');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function requireAuth(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use('/api/trades', requireAuth);

// List trades
router.get('/api/trades', async (req, res) => {
  try {
    const { scope = 'user', status, symbol, from, to, page, limit } = req.query;
    const trades = await tradeService.getTradesForUser(req.user.id, scope, { status, symbol, from, to, page: +page || 1, limit: +limit || 100 });
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trade summary (aggregated stats)
router.get('/api/trades/summary', async (req, res) => {
  try {
    const { scope = 'user', from, to } = req.query;
    const summary = await tradeService.getSummary(req.user.id, scope, { from, to });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User tags
router.get('/api/trades/tags', async (req, res) => {
  try {
    const tags = await tradeModel.getUserTags(req.user.id);
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/trades/tags', async (req, res) => {
  try {
    const { name, colour } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Tag name required' });
    const tag = await tradeModel.createTag(req.user.id, name, colour);
    if (!tag) return res.status(409).json({ error: 'Tag already exists' });
    res.status(201).json(tag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/trades/tags/:tagId', async (req, res) => {
  try {
    const deleted = await tradeModel.deleteTag(+req.params.tagId, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Tag not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single trade
router.get('/api/trades/:tradeId', async (req, res) => {
  try {
    const trade = await tradeService.getTradeDetail(+req.params.tradeId, req.user.id);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });
    res.json(trade);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create manual trade
router.post('/api/trades', async (req, res) => {
  try {
    const { symbol, side, entryPrice, exitPrice, qty, commission, openedAt, closedAt, setupType, conviction, notes } = req.body || {};
    if (!symbol || !side || !entryPrice || !qty) {
      return res.status(400).json({ error: 'symbol, side, entryPrice, and qty are required' });
    }
    const trade = await tradeService.logManualTrade(req.user.id, { symbol, side, entryPrice: +entryPrice, exitPrice: exitPrice != null ? +exitPrice : null, qty: +qty, commission: commission != null ? +commission : 0, openedAt, closedAt, setupType, conviction: conviction != null ? +conviction : null, notes });
    res.status(201).json(trade);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update trade
router.put('/api/trades/:tradeId', async (req, res) => {
  try {
    const updated = await tradeModel.updateTrade(+req.params.tradeId, req.user.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Trade not found' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete trade
router.delete('/api/trades/:tradeId', async (req, res) => {
  try {
    const deleted = await tradeModel.deleteTrade(+req.params.tradeId, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Trade not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger broker import
router.post('/api/trades/import', async (req, res) => {
  try {
    const { brokerType, from, to } = req.body || {};
    if (!brokerType) return res.status(400).json({ error: 'brokerType required' });
    const result = await tradeService.importExecutions(req.user.id, brokerType, { from, to });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Trade metadata
router.get('/api/trades/:tradeId/metadata', async (req, res) => {
  try {
    const meta = await tradeModel.getMetadata(+req.params.tradeId);
    res.json(meta || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/trades/:tradeId/metadata', async (req, res) => {
  try {
    const meta = await tradeModel.upsertMetadata(+req.params.tradeId, req.body);
    res.json(meta);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Upload file and parse trades (PDF, CSV, TXT)
router.post('/api/trades/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const mime = req.file.mimetype;
    const name = (req.file.originalname || '').toLowerCase();
    let result;
    if (mime === 'application/pdf') {
      result = await parsePdf(req.file.buffer);
    } else if (name.endsWith('.xls') || name.endsWith('.xlsx') ||
               mime === 'application/vnd.ms-excel' ||
               mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      result = parseExcel(req.file.buffer);
    } else {
      // CSV, TXT, or other text formats
      const text = req.file.buffer.toString('utf-8');
      result = parseText(text);
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: 'Failed to parse file: ' + err.message });
  }
});

// Parse pasted text (Saxo execution log, CSV, etc.)
router.post('/api/trades/parse-text', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'No text provided' });
    }
    const result = parseText(text.trim());
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: 'Failed to parse text: ' + err.message });
  }
});

// Confirm and save parsed trades (scope: 'demo' or 'user')
router.post('/api/trades/upload/confirm', async (req, res) => {
  try {
    const { trades, scope } = req.body || {};
    const datasetScope = scope === 'user' ? 'user' : 'demo';
    if (!Array.isArray(trades) || trades.length === 0) {
      return res.status(400).json({ error: 'No trades to save' });
    }
    const saved = [];
    for (const t of trades) {
      if (!t.ticker || !t.entryPrice || !t.qty) continue;
      const row = await tradeModel.insertTrade({
        userId: req.user.id,
        datasetScope,
        symbol: t.ticker.toUpperCase(),
        side: t.side || 'long',
        entryPrice: +t.entryPrice,
        exitPrice: t.exitPrice != null ? +t.exitPrice : null,
        qty: +t.qty,
        pnlDollar: t.pnlDollar != null ? +t.pnlDollar : null,
        pnlPercent: t.pnlPercent != null ? +t.pnlPercent : null,
        commissionTotal: t.commission != null ? +t.commission : 0,
        openedAt: t.openedAt || new Date().toISOString(),
        closedAt: t.closedAt || null,
        durationSeconds: null,
        status: t.exitPrice != null ? 'closed' : 'open',
      });
      saved.push(row);
    }
    res.json({ saved: saved.length, skipped: trades.length - saved.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin: delete demo trades (only demo scope, never user scope)
router.delete('/api/trades/admin/demo/:tradeId', async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const tradeId = +req.params.tradeId;
    // Verify trade is demo scope before deleting
    const { pool } = require('../db/pg');
    const check = await pool.query(
      "SELECT trade_id FROM trades WHERE trade_id = $1 AND dataset_scope = 'demo'",
      [tradeId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Demo trade not found. Only demo trades can be deleted via admin.' });
    }
    await pool.query('DELETE FROM trades WHERE trade_id = $1', [tradeId]);
    res.json({ success: true, deleted: tradeId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: bulk delete all demo trades
router.delete('/api/trades/admin/demo', async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { pool } = require('../db/pg');
    const result = await pool.query("DELETE FROM trades WHERE dataset_scope = 'demo'");
    await pool.query("DELETE FROM broker_executions WHERE dataset_scope = 'demo'");
    await pool.query("DELETE FROM daily_reviews WHERE dataset_scope = 'demo'");
    res.json({ success: true, deletedTrades: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
