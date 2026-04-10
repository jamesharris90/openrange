const path = require('path');
const pool = require('../db/pool');
const { resolveDatabaseUrl } = require('../db/connectionConfig');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  const { host } = resolveDatabaseUrl();

  try {
    const result = await pool.query('SELECT NOW() AS now');
    console.log(`DB CONNECTED TO: ${host}`);
    console.log('DB_TIME', result.rows?.[0]?.now || null);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('DB CONNECTION FAILED:', error.code || '', error.message || '');
  process.exit(1);
});
