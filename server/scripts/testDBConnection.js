const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  try {
    const result = await pool.query('SELECT NOW() AS now');
    console.log('DB CONNECTED');
    console.log('DB_TIME', result.rows?.[0]?.now || null);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('DB CONNECTION FAILED:', error.code || '', error.message || '');
  process.exit(1);
});
