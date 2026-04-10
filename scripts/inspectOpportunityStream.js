require('dotenv').config({ path: 'server/.env', override: true });
const pool = require('../server/db/pool');

(async () => {
  const summary = await pool.query(
    "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE source='real' AND updated_at > NOW() - INTERVAL '15 minutes')::int AS fresh_real, COUNT(*) FILTER (WHERE source='real' AND updated_at > NOW() - INTERVAL '15 minutes' AND NULLIF(TRIM(why),'') IS NOT NULL)::int AS with_why, COUNT(*) FILTER (WHERE source='real' AND updated_at > NOW() - INTERVAL '15 minutes' AND NULLIF(TRIM(how),'') IS NOT NULL)::int AS with_how, COUNT(*) FILTER (WHERE source='real' AND updated_at > NOW() - INTERVAL '15 minutes' AND expected_move IS NOT NULL)::int AS with_expected FROM opportunity_stream"
  );

  const sample = await pool.query(
    "SELECT UPPER(symbol) AS symbol, source, updated_at, why, how, expected_move, confidence FROM opportunity_stream WHERE source='real' AND updated_at > NOW() - INTERVAL '15 minutes' ORDER BY confidence DESC NULLS LAST LIMIT 25"
  );

  console.log(JSON.stringify({ summary: summary.rows[0], sample_count: sample.rows.length, sample: sample.rows.slice(0, 10) }, null, 2));
  await pool.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
