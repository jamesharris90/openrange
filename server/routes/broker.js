const express = require('express');
const rateLimit = require('express-rate-limit');
const brokerService = require('../services/brokerService');

const router = express.Router();

const brokerLimiter = rateLimit({ windowMs: 30 * 1000, max: 60 });

function requireAuth(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Scope broker middleware so it does not block unrelated public routes
router.use('/api/broker', brokerLimiter, requireAuth);

router.post('/api/broker/connect/:broker', async (req, res) => {
  const broker = (req.params.broker || '').toLowerCase();
  const { accessToken = null, refreshToken = null, username = null, password = null } = req.body || {};
  try {
    const status = await brokerService.connectBroker(req.user.id, broker, { accessToken, refreshToken, username, password });
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to connect broker' });
  }
});

router.post('/api/broker/disconnect', async (req, res) => {
  try {
    const status = await brokerService.disconnectBroker(req.user.id);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to disconnect broker' });
  }
});

router.get('/api/broker/status', async (req, res) => {
  try {
    const status = await brokerService.getBrokerStatus(req.user.id);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch broker status' });
  }
});

router.get('/api/broker/account', async (req, res) => {
  try {
    const snapshot = await brokerService.getAccountSnapshot(req.user.id);
    res.json(snapshot);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to load account snapshot' });
  }
});

router.get('/api/broker/positions', async (req, res) => {
  try {
    const positions = await brokerService.getOpenPositions(req.user.id);
    res.json(positions);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to load positions' });
  }
});

router.get('/api/broker/pnl/daily', async (req, res) => {
  try {
    const pnl = await brokerService.getDailyPnL(req.user.id);
    res.json(pnl);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to load daily PnL' });
  }
});

router.get('/api/broker/performance/weekly', async (req, res) => {
  try {
    const curve = await brokerService.getWeeklyPerformance(req.user.id);
    res.json(curve);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to load performance' });
  }
});

router.get('/api/broker/health', async (req, res) => {
  try {
    const health = await brokerService.getHealthSummary(req.user.id);
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load broker health' });
  }
});

router.get('/api/broker/admin/health/:userId', requireAdmin, async (req, res) => {
  try {
    const health = await brokerService.getHealthSummary(Number(req.params.userId));
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load broker health' });
  }
});

router.post('/api/broker/admin/revoke/:userId', requireAdmin, async (req, res) => {
  try {
    const status = await brokerService.revokeBroker(Number(req.params.userId));
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to revoke broker connection' });
  }
});

module.exports = router;
