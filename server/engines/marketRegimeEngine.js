'use strict';

const { queryWithTimeout } = require('../db/pg');

function toMarketRegime(spyTrend, vixLevel, breadthPercent) {
  if (spyTrend === 'UP' && vixLevel < 20 && breadthPercent >= 55) return 'risk_on';
  if (spyTrend === 'DOWN' && vixLevel > 24 && breadthPercent <= 45) return 'risk_off';
  return 'neutral';
}

async function runMarketRegimeEngine() {
  const startedAt = Date.now();
  console.log('[MARKET REGIME ENGINE] start');

  try {
    const snapshot = await queryWithTimeout(
      `WITH spy AS (
         SELECT close
         FROM daily_ohlc
         WHERE symbol = 'SPY'
         ORDER BY date DESC
         LIMIT 20
       ),
       vix AS (
         SELECT close
         FROM daily_ohlc
         WHERE symbol IN ('^VIX', 'VIX')
         ORDER BY date DESC
         LIMIT 1
       ),
       breadth AS (
         SELECT
           100.0 * AVG(CASE WHEN COALESCE((to_jsonb(mm)->>'price_change_percent')::numeric, (to_jsonb(mm)->>'change_percent')::numeric, 0) > 0 THEN 1 ELSE 0 END) AS breadth_percent
         FROM market_metrics mm
       ),
       sector AS (
         SELECT COALESCE(jsonb_object_agg(sector_key, avg_move), '{}'::jsonb) AS sector_strength
         FROM (
           SELECT
             COALESCE(NULLIF(to_jsonb(mm)->>'sector', ''), 'Unknown') AS sector_key,
             AVG(COALESCE((to_jsonb(mm)->>'price_change_percent')::numeric, (to_jsonb(mm)->>'change_percent')::numeric, 0))::numeric AS avg_move
           FROM market_metrics mm
           GROUP BY 1
         ) x
       )
       SELECT
         CASE
           WHEN (SELECT COUNT(*) FROM spy) < 2 THEN 'FLAT'
           WHEN (SELECT close FROM spy LIMIT 1) > (SELECT AVG(close) FROM spy) THEN 'UP'
           WHEN (SELECT close FROM spy LIMIT 1) < (SELECT AVG(close) FROM spy) THEN 'DOWN'
           ELSE 'FLAT'
         END AS spy_trend,
         COALESCE((SELECT close FROM vix LIMIT 1), 0)::numeric AS vix_level,
         COALESCE((SELECT breadth_percent FROM breadth), 50)::numeric AS breadth_percent,
         (SELECT sector_strength FROM sector) AS sector_strength`,
      [],
      { timeoutMs: 15000, label: 'market_regime.snapshot', maxRetries: 0 }
    );

    const row = snapshot?.rows?.[0] || {};
    const spyTrend = String(row.spy_trend || 'FLAT').toUpperCase();
    const vixLevel = Number(row.vix_level || 0);
    const breadthPercent = Number(row.breadth_percent || 0);
    const marketRegime = toMarketRegime(spyTrend, vixLevel, breadthPercent);

    await queryWithTimeout(
      `DELETE FROM market_regime_daily WHERE date = CURRENT_DATE`,
      [],
      { timeoutMs: 8000, label: 'market_regime.delete_today', maxRetries: 0 }
    );

    await queryWithTimeout(
      `INSERT INTO market_regime_daily (
         date,
         spy_trend,
         vix_level,
         market_regime,
         sector_strength,
         breadth_percent,
         created_at
       ) VALUES (
         CURRENT_DATE,
         $1,
         $2,
         $3,
         $4::jsonb,
         $5,
         NOW()
       )`,
      [spyTrend, vixLevel, marketRegime, JSON.stringify(row.sector_strength || {}), breadthPercent],
      { timeoutMs: 10000, label: 'market_regime.insert', maxRetries: 0 }
    );

    const runtimeMs = Date.now() - startedAt;
    console.log(`[MARKET REGIME ENGINE] complete regime=${marketRegime} runtime_ms=${runtimeMs}`);
    return { ok: true, marketRegime, runtimeMs };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    console.error('[MARKET REGIME ENGINE] error', error.message);
    return { ok: false, marketRegime: 'unknown', runtimeMs, error: error.message };
  }
}

module.exports = {
  runMarketRegimeEngine,
};
