const db = require('../db');
const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT *
      FROM strategy_signals
      WHERE updated_at >= NOW() - INTERVAL '15 minutes'
      ORDER BY score DESC
    `);

    const radar = {
      A: [],
      B: [],
      C: [],
    };

    rows.forEach((row) => {
      if (row.class === 'Class A' || row.class === 'A') {
        radar.A.push(row);
      } else if (row.class === 'Class B' || row.class === 'B') {
        radar.B.push(row);
      } else {
        radar.C.push(row);
      }
    });

    res.json(radar);
  } catch (err) {
    console.error('[RADAR API ERROR]', err);
    res.status(500).json({ error: 'Radar fetch failed' });
  }
});

module.exports = router;
