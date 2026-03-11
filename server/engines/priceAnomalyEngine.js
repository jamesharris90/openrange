const { queryWithTimeout } = require('../db/pg');
const EVENT_TYPES = require('../events/eventTypes');
const eventBus = require('../events/eventBus');
const logger = require('../logger');

function pctMove(prev, curr) {
  const a = Number(prev);
  const b = Number(curr);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return 0;
  return ((b - a) / Math.abs(a)) * 100;
}

async function runPriceAnomalyEngine(limit = 60) {
  const startedAt = Date.now();
  const anomalies = [];

  try {
    const { rows: symbols } = await queryWithTimeout(
      `SELECT symbol
       FROM market_quotes
       WHERE symbol IS NOT NULL AND symbol <> ''
       ORDER BY COALESCE(volume, 0) DESC NULLS LAST
       LIMIT $1`,
      [Math.max(1, Math.min(Number(limit) || 60, 250))],
      { timeoutMs: 5000, label: 'integrity.anomaly.symbols', maxRetries: 0 }
    );

    for (const entry of symbols || []) {
      const symbol = String(entry.symbol || '').toUpperCase();
      if (!symbol) continue;

      const { rows } = await queryWithTimeout(
        `SELECT timestamp, close, volume
         FROM intraday_1m
         WHERE symbol = $1
         ORDER BY timestamp DESC
         LIMIT 30`,
        [symbol],
        { timeoutMs: 3000, label: 'integrity.anomaly.series', maxRetries: 0 }
      );

      if ((rows || []).length < 2) continue;

      const latest = rows[0];
      const previous = rows[1];
      const move = pctMove(previous.close, latest.close);
      const volumes = rows.slice(1).map((row) => Number(row.volume || 0));
      const avgVolume = volumes.length ? volumes.reduce((sum, n) => sum + n, 0) / volumes.length : 0;
      const latestVolume = Number(latest.volume || 0);

      const negativePrice = Number(latest.close) < 0;
      const largeMove = Math.abs(move) > 15;
      const volumeSpike = avgVolume > 0 && latestVolume > avgVolume * 10;

      if (negativePrice || largeMove || volumeSpike) {
        const anomaly = {
          symbol,
          source: 'price_anomaly_engine',
          timeframe: '1m',
          move_percent: Number(move.toFixed(3)),
          price: Number(latest.close || 0),
          latest_volume: latestVolume,
          avg_volume: Number(avgVolume.toFixed(2)),
          issue: negativePrice
            ? 'negative_price'
            : largeMove
              ? 'abnormal_move'
              : 'volume_spike',
          severity: largeMove || negativePrice ? 'high' : 'medium',
          timestamp: new Date().toISOString(),
        };

        anomalies.push(anomaly);
        eventBus.emit(EVENT_TYPES.PRICE_ANOMALY, anomaly);
        eventBus.emit(EVENT_TYPES.DATA_INTEGRITY_WARNING, anomaly);
        if (volumeSpike) {
          eventBus.emit(EVENT_TYPES.VOLUME_SPIKE, anomaly);
        }
      }
    }

    return {
      ok: true,
      scanned_symbols: (symbols || []).length,
      anomalies,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('[ENGINE ERROR] price_anomaly_engine failed', { error: error.message });
    return {
      ok: false,
      scanned_symbols: 0,
      anomalies,
      error: error.message,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
    };
  }
}

module.exports = {
  runPriceAnomalyEngine,
};
