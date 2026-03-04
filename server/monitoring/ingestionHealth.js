const { pool } = require('../db/pg');

async function getIngestionHealth() {
  const { rows } = await pool.query(`
    SELECT table_name,
           row_count,
           last_update
    FROM (
      SELECT 'daily_ohlc'::text AS table_name,
             COUNT(*)::int AS row_count,
             MAX(date::timestamp) AS last_update
      FROM daily_ohlc

      UNION ALL

      SELECT 'intraday_1m'::text AS table_name,
             COUNT(*)::int AS row_count,
             MAX(timestamp) AS last_update
      FROM intraday_1m

      UNION ALL

      SELECT 'news_articles'::text AS table_name,
             COUNT(*)::int AS row_count,
             MAX(published_at) AS last_update
      FROM news_articles

      UNION ALL

      SELECT 'earnings_events'::text AS table_name,
             COUNT(*)::int AS row_count,
             MAX(report_date::timestamp) AS last_update
      FROM earnings_events
    ) x
    ORDER BY table_name ASC
  `);

  return {
    engine: 'ingestion',
    tables: rows.map((row) => ({
      table: row.table_name,
      rows: Number(row.row_count) || 0,
      last_update: row.last_update,
    })),
    status: 'ok',
  };
}

module.exports = {
  getIngestionHealth,
};
