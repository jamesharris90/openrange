const logger = require('../logger');
const { pool } = require('../db/pg');

async function runMetricsEngine() {
  const startedAt = Date.now();

  const { rows } = await pool.query(
    `SELECT mq.symbol,
            mq.change_percent,
            mq.volume,
            COALESCE(mq.volume::numeric, 0) AS avg_volume_30d
     FROM market_quotes mq`
  );

  const normalized = [];
  for (const row of rows) {
    const avgVolume30d = Number.isFinite(Number(row.avg_volume_30d)) ? Number(row.avg_volume_30d) : null;
    const volume = Number.isFinite(Number(row.volume)) ? Number(row.volume) : null;
    const relativeVolume = avgVolume30d && volume ? volume / avgVolume30d : null;
    const gapPercent = Number.isFinite(Number(row.change_percent)) ? Number(row.change_percent) : null;
    normalized.push({
      symbol: row.symbol,
      gapPercent,
      relativeVolume,
      avgVolume30d,
    });
  }

  const batchSize = 500;
  let upserted = 0;

  for (let i = 0; i < normalized.length; i += batchSize) {
    const batch = normalized.slice(i, i + batchSize);
    const symbols = batch.map((item) => item.symbol);
    const gaps = batch.map((item) => item.gapPercent);
    const relVols = batch.map((item) => item.relativeVolume);
    const avgVols = batch.map((item) => item.avgVolume30d);

    await pool.query(
      `INSERT INTO market_metrics (symbol, gap_percent, relative_volume, avg_volume_30d, updated_at)
       SELECT *
       FROM (
         SELECT
           unnest($1::text[]) AS symbol,
           unnest($2::numeric[]) AS gap_percent,
           unnest($3::numeric[]) AS relative_volume,
           unnest($4::numeric[]) AS avg_volume_30d,
           now() AS updated_at
       ) incoming
       ON CONFLICT(symbol)
       DO UPDATE SET
         gap_percent = EXCLUDED.gap_percent,
         relative_volume = EXCLUDED.relative_volume,
         avg_volume_30d = EXCLUDED.avg_volume_30d,
         updated_at = now()`,
      [symbols, gaps, relVols, avgVols]
    );

    upserted += batch.length;
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('Metrics engine complete', {
    symbolsRead: rows.length,
    upserted,
    runtimeMs,
  });

  return {
    symbolsRead: rows.length,
    upserted,
    runtimeMs,
  };
}

module.exports = {
  runMetricsEngine,
};
