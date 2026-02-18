const cron = require('node-cron');
const { pool } = require('../../db/pg');
const logger = require('../../logger');

function startDailyReviewCron() {
  // Run at midnight ET (05:00 UTC during EST, 04:00 UTC during EDT)
  cron.schedule('0 5 * * *', async () => {
    logger.info('Daily review cron: starting auto-creation');
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().slice(0, 10);

      // Find users who traded yesterday but have no review
      const result = await pool.query(`
        SELECT DISTINCT t.user_id, t.dataset_scope,
          COUNT(*)::int AS total_trades,
          COUNT(*) FILTER (WHERE t.pnl_dollar > 0)::int AS wins,
          SUM(t.pnl_dollar) AS total_pnl
        FROM trades t
        WHERE t.closed_at::date = $1
          AND t.status = 'closed'
          AND NOT EXISTS (
            SELECT 1 FROM daily_reviews dr
            WHERE dr.user_id = t.user_id
              AND dr.dataset_scope = t.dataset_scope
              AND dr.review_date = $1
          )
        GROUP BY t.user_id, t.dataset_scope
      `, [dateStr]);

      for (const row of result.rows) {
        const winRate = row.total_trades > 0
          ? +((row.wins / row.total_trades) * 100).toFixed(2)
          : 0;

        await pool.query(`
          INSERT INTO daily_reviews (user_id, dataset_scope, review_date, total_pnl, total_trades, win_rate)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (user_id, dataset_scope, review_date) DO NOTHING
        `, [row.user_id, row.dataset_scope, dateStr, row.total_pnl, row.total_trades, winRate]);
      }

      logger.info(`Daily review cron: created ${result.rows.length} review stubs for ${dateStr}`);
    } catch (err) {
      logger.error('Daily review cron error:', { error: err.message });
    }
  }, { timezone: 'America/New_York' });

  logger.info('Daily review cron scheduled (midnight ET)');
}

module.exports = { startDailyReviewCron };
