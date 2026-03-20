/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL_DISABLE === 'true' ? false : { rejectUnauthorized: false },
  });

  const sqlPath = path.resolve(process.cwd(), 'server/db/migrations/016_fmp_events_rebuild.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(50) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT (version) DO NOTHING`,
      ['016_fmp_events_rebuild']
    );
    await client.query('COMMIT');
    console.log('Applied migration 016_fmp_events_rebuild successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
