const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function runCalibrationPriceUpdater() {
  try {
    logger.info('[ENGINE_START] calibration_price_updater');

    const { rows } = await queryWithTimeout(
      `SELECT
         c.id,
         c.symbol,
         c.entry_price,
         m.price AS live_price,
         d.high AS daily_high,
         d.low AS daily_low,
         d.close AS daily_close
       FROM signal_calibration_log c
       LEFT JOIN market_metrics m ON m.symbol = c.symbol
       LEFT JOIN LATERAL (
         SELECT high, low, close
         FROM daily_ohlc d
         WHERE d.symbol = c.symbol
         ORDER BY d.date DESC
         LIMIT 1
       ) d ON TRUE`,
      [],
      { timeoutMs: 10000, label: 'calibration_price_updater.select', maxRetries: 0 }
    );

    const items = Array.isArray(rows) ? rows : [];
    let updated = 0;

    for (const row of items) {
      const entryPrice = Number(row.entry_price);
      const livePrice = Number(row.live_price);
      const dailyHigh = Number(row.daily_high);
      const dailyLow = Number(row.daily_low);
      const dailyClose = Number(row.daily_close);

      const close1h = Number.isFinite(livePrice) ? livePrice : entryPrice;
      const close4h = Number.isFinite(livePrice) ? livePrice : entryPrice;
      const close1d = Number.isFinite(dailyClose) ? dailyClose : close4h;

      const high1h = Number.isFinite(livePrice) ? Math.max(entryPrice, livePrice) : entryPrice;
      const low1h = Number.isFinite(livePrice) ? Math.min(entryPrice, livePrice) : entryPrice;
      const high4h = high1h;
      const low4h = low1h;
      const high1d = Number.isFinite(dailyHigh) ? dailyHigh : high4h;
      const low1d = Number.isFinite(dailyLow) ? dailyLow : low4h;

      const allHighs = [high1h, high4h, high1d, close1h, close4h, close1d].filter(Number.isFinite);
      const allLows = [low1h, low4h, low1d, close1h, close4h, close1d].filter(Number.isFinite);
      const maxPrice = allHighs.length ? Math.max(...allHighs) : entryPrice;
      const minPrice = allLows.length ? Math.min(...allLows) : entryPrice;

      const maxMovePercent = Number.isFinite(entryPrice) && entryPrice > 0
        ? ((maxPrice - entryPrice) / entryPrice) * 100
        : null;
      const minMovePercent = Number.isFinite(entryPrice) && entryPrice > 0
        ? ((minPrice - entryPrice) / entryPrice) * 100
        : null;
      const success = Number.isFinite(close1d) && Number.isFinite(entryPrice)
        ? close1d >= entryPrice
        : null;

      await queryWithTimeout(
        `UPDATE signal_calibration_log
         SET
           high_1h = $2,
           low_1h = $3,
           close_1h = $4,
           high_4h = $5,
           low_4h = $6,
           close_4h = $7,
           high_1d = $8,
           low_1d = $9,
           close_1d = $10,
           max_move_percent = $11,
           min_move_percent = $12,
           success = $13
         WHERE id = $1`,
        [
          row.id,
          high1h,
          low1h,
          close1h,
          high4h,
          low4h,
          close4h,
          high1d,
          low1d,
          close1d,
          maxMovePercent,
          minMovePercent,
          success,
        ],
        { timeoutMs: 10000, label: 'calibration_price_updater.update', maxRetries: 0 }
      );
      updated += 1;
    }

    logger.info('[ENGINE_COMPLETE] calibration_price_updater', { updated });
    return { updated };
  } catch (error) {
    logger.error('[ENGINE_ERROR] calibration_price_updater', { error: error.message });
    throw error;
  }
}

module.exports = {
  runCalibrationPriceUpdater,
};