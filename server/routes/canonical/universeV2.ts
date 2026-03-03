// @ts-nocheck
const express = require('express');
const { getUniverseV2 } = require('../../services/universeBuilderV2');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const { data, fromCache, lastBuildTime } = await getUniverseV2();
    const rows = Array.isArray(data) ? data : [];

    const nasdaqCount = rows.filter((r) => r?.exchange === 'NASDAQ').length;
    const nyseCount = rows.filter((r) => r?.exchange === 'NYSE').length;
    const amexCount = rows.filter((r) => r?.exchange === 'AMEX').length;
    const uniqueSymbols = new Set(rows.map((r) => r?.symbol).filter(Boolean));
    const hasDuplicates = uniqueSymbols.size !== rows.length;
    const sample = rows[0] || null;

    console.log('Universe count:', rows.length);
    console.log('NASDAQ count:', nasdaqCount);
    console.log('NYSE count:', nyseCount);
    console.log('AMEX count:', amexCount);
    console.log('Has duplicates:', hasDuplicates);
    console.log('Sample symbol:', sample?.symbol || null);

    return res.json({
      total: rows.length,
      fromCache,
      lastBuildTime,
      data: rows,
      breakdown: {
        NASDAQ: nasdaqCount,
        NYSE: nyseCount,
        AMEX: amexCount,
      },
      sample,
    });
  } catch (error) {
    console.warn('[canonical/universe-v2] failed softly', {
      message: error?.message,
    });

    return res.status(200).json({
      total: 0,
      fromCache: false,
      lastBuildTime: null,
      data: [],
      breakdown: {
        NASDAQ: 0,
        NYSE: 0,
        AMEX: 0,
      },
      sample: null,
      warning: 'Universe build failed softly',
    });
  }
});

module.exports = router;
