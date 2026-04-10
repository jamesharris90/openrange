/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const pool = require('../server/db/pool');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

async function run() {
  const sqlPath = path.resolve(process.cwd(), 'server/db/migrations/016_fmp_events_rebuild.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(50) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(sql);
    await pool.query(
      `INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT (version) DO NOTHING`,
      ['016_fmp_events_rebuild']
    );
    console.log('Applied migration 016_fmp_events_rebuild successfully');
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
