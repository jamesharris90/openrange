const express = require('express');
const { seedDemoData, clearDemoData } = require('../services/trades/demoSeeder');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use('/api/demo', requireAuth);

router.post('/api/demo/seed', async (req, res) => {
  try {
    const result = await seedDemoData(req.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/demo/clear', async (req, res) => {
  try {
    const result = await clearDemoData(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
