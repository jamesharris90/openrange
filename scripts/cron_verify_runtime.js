require('dotenv').config({ path: '/Users/jamesharris/Server/server/.env' });

const pool = require('../server/db/pool');

const BASE_URL = process.env.CRON_VERIFY_BASE_URL || 'http://localhost:3102';

function parseRows(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.rows)) return body.rows;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body)) return body;
  return [];
}

async function tableCounts(client) {
  const names = ['market_metrics', 'trade_setups', 'catalysts', 'trade_catalysts', 'earnings', 'earnings_events'];
  const out = {};
  for (const name of names) {
    const exists = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${name}`]);
    if (!exists.rows[0].ok) {
      out[name] = null;
      continue;
    }

    const count = await client.query(`SELECT COUNT(*)::int AS c FROM ${name}`);
    out[name] = count.rows[0].c;
  }
  return out;
}

async function readJson(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: { error: error.message } };
  }
}

async function run() {
  console.log('VERIFY_START', BASE_URL);

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.PROXY_API_KEY) {
    headers['x-api-key'] = process.env.PROXY_API_KEY;
  }

  const before = await tableCounts(pool);
  console.log('DB_BEFORE', JSON.stringify(before));

  const cronStatusPre = await readJson(`${BASE_URL}/api/system/cron-status`, { headers });
  console.log('CRON_STATUS_PRE', cronStatusPre.status, Array.isArray(cronStatusPre.body?.recent_runs) ? cronStatusPre.body.recent_runs.length : JSON.stringify(cronStatusPre.body));

  const runAll = await readJson(`${BASE_URL}/api/cron/run-all`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  console.log('RUN_ALL', runAll.status, JSON.stringify(runAll.body));

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const cronStatusPost = await readJson(`${BASE_URL}/api/system/cron-status`, { headers });
  const tail = Array.isArray(cronStatusPost.body?.recent_runs)
    ? cronStatusPost.body.recent_runs.slice(-12)
    : [];
  console.log('CRON_STATUS_POST', cronStatusPost.status, Array.isArray(cronStatusPost.body?.recent_runs) ? cronStatusPost.body.recent_runs.length : JSON.stringify(cronStatusPost.body));
  console.log('CRON_TAIL', JSON.stringify(tail));

  const sip = await readJson(`${BASE_URL}/api/stocks-in-play?limit=5`, { headers });
  const top = await readJson(`${BASE_URL}/api/intelligence/top-opportunities?limit=5`, { headers });
  console.log('SIP', sip.status, parseRows(sip.body).length);
  console.log('TOP', top.status, parseRows(top.body).length);

  const after = await tableCounts(pool);
  console.log('DB_AFTER', JSON.stringify(after));

  await pool.end();
}

run().catch((error) => {
  console.error('VERIFY_FAILED', error.message);
  process.exitCode = 1;
});
