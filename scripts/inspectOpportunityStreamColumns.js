require('dotenv').config({ path: 'server/.env', override: true });
const pool = require('../server/db/pool');

(async () => {
  const cols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='opportunity_stream' ORDER BY ordinal_position"
  );
  console.log(JSON.stringify(cols.rows.map((r) => r.column_name), null, 2));
  await pool.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
