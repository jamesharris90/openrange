const express = require('express');

const { getCache, setCache } = require('../cache/memoryCache');
const { getOpportunityRows } = require('../services/opportunitiesService');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const cached = getCache('opportunities-v2');
    if (cached) {
      return res.json(cached);
    }

    const rows = await getOpportunityRows();
    const payload = {
      success: true,
      count: rows.length,
      data: rows,
    };

    setCache('opportunities-v2', payload, 60000);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;