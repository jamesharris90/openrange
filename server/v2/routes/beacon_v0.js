const express = require('express');
const { SIGNALS } = require('../../beacon-v0/orchestrator/run');
const { getLatestPicks } = require('../../beacon-v0/persistence/picks');
const { queryWithTimeout } = require('../../db/pg');

const router = express.Router();

const forwardLookingMap = new Map();
SIGNALS.forEach((signal) => {
  if (signal && signal.SIGNAL_NAME) {
    forwardLookingMap.set(signal.SIGNAL_NAME, Boolean(signal.FORWARD_LOOKING));
  }
});

function enrichPickDirectionCounts(pick) {
  const signalsAligned = Array.isArray(pick.signals_aligned) ? pick.signals_aligned : [];
  const forwardCount = signalsAligned.filter((signalName) => forwardLookingMap.get(signalName) === true).length;

  return {
    ...pick,
    forward_count: forwardCount,
    backward_count: signalsAligned.length - forwardCount,
  };
}

async function fetchPickPriceData(symbols) {
  const uniqueSymbols = [...new Set((symbols || []).filter(Boolean).map((symbol) => String(symbol).trim().toUpperCase()))];
  if (uniqueSymbols.length === 0) return new Map();

  const priceResult = await queryWithTimeout(
    `
      WITH latest_session AS (
        SELECT MAX(date) AS d
        FROM daily_ohlc
        WHERE symbol = ANY($1::text[])
      ),
      ranked AS (
        SELECT
          symbol,
          date,
          close,
          ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS days_back
        FROM daily_ohlc
        WHERE symbol = ANY($1::text[])
          AND date <= (SELECT d FROM latest_session)
          AND date > (SELECT d FROM latest_session) - INTERVAL '30 days'
      )
      SELECT symbol, date, close, days_back
      FROM ranked
      WHERE days_back <= 20
      ORDER BY symbol, days_back ASC
    `,
    [uniqueSymbols],
    {
      label: 'beacon_v0.price_enrichment',
      timeoutMs: 8000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  const priceMap = new Map();
  priceResult.rows.forEach((row) => {
    if (!priceMap.has(row.symbol)) {
      priceMap.set(row.symbol, { closes: [] });
    }

    const close = parseFloat(row.close);
    if (Number.isFinite(close)) {
      priceMap.get(row.symbol).closes.push({
        date: row.date,
        close,
        days_back: parseInt(row.days_back, 10),
      });
    }
  });

  priceMap.forEach((data) => {
    const closes = data.closes.sort((a, b) => a.days_back - b.days_back);
    const latest = closes[0];
    const prior = closes[1];

    data.latest_close = latest ? latest.close : null;
    data.prior_close = prior ? prior.close : null;
    data.change_pct = latest && prior && prior.close > 0
      ? ((latest.close - prior.close) / prior.close) * 100
      : null;
    data.sparkline = closes.slice().reverse().map((item) => item.close);
  });

  return priceMap;
}

function enrichPickPriceData(pick, priceMap) {
  const priceData = priceMap.get(pick.symbol) || {};
  return {
    ...pick,
    latest_close: priceData.latest_close ?? null,
    prior_close: priceData.prior_close ?? null,
    change_pct: priceData.change_pct ?? null,
    sparkline: priceData.sparkline || [],
  };
}

router.get('/picks', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const picks = (await getLatestPicks(limit)).map(enrichPickDirectionCounts);
    const priceMap = await fetchPickPriceData(picks.map((pick) => pick.symbol));
    const enrichedPicks = picks.map((pick) => enrichPickPriceData(pick, priceMap));

    return res.json({
      picks: enrichedPicks,
      count: enrichedPicks.length,
      version: 'v0',
      generated_at: enrichedPicks[0]?.created_at || null,
      run_id: enrichedPicks[0]?.run_id || null,
    });
  } catch (error) {
    console.error('beacon_v0_picks_failed:', error.message);
    return res.status(500).json({
      error: 'beacon_v0_picks_failed',
      message: error.message,
    });
  }
});

module.exports = router;