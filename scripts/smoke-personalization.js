require('dotenv').config({ path: './server/.env' });
const { pool } = require('../server/db/pg');

async function call(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function run() {
  const seed = `saas_${Date.now()}`;
  const email = `${seed}@example.com`;
  const password = 'SaaSTest123!';

  await call('http://localhost:3000/api/users/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: seed, email, password }),
  });

  const login = await call('http://localhost:3000/api/users/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password }),
  });

  const token = login.body?.token;
  const userId = login.body?.user?.id;
  if (!token || !userId) throw new Error('Login token was not returned');

  await call('http://localhost:3000/api/signals', {
    headers: { Authorization: `Bearer ${token}` },
  });

  await pool.query(
    `INSERT INTO user_preferences (user_id, min_rvol, min_gap, preferred_sectors, enabled_strategies, updated_at)
     VALUES ($1, $2, $3, $4::text[], $5::text[], now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       min_rvol = EXCLUDED.min_rvol,
       min_gap = EXCLUDED.min_gap,
       preferred_sectors = EXCLUDED.preferred_sectors,
       enabled_strategies = EXCLUDED.enabled_strategies,
       updated_at = now()`,
    [userId, 2, 1, ['Technology', 'Financial Services'], ['Gap & Go', 'ORB Breakout']]
  );

  await pool.query(
    `INSERT INTO user_watchlists (user_id, symbol)
     VALUES ($1, 'AAPL'), ($1, 'SPY')
     ON CONFLICT (user_id, symbol) DO NOTHING`,
    [userId]
  );

  const headers = { Authorization: `Bearer ${token}` };
  const signals = await call('http://localhost:3000/api/signals', { headers });
  const watchlist = await call('http://localhost:3000/api/watchlist/signals', { headers });

  const signalId = signals.body?.signals?.[0]?.symbol || 'SPY';
  const feedback = await call('http://localhost:3000/api/signals/feedback', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ signal_id: signalId, rating: 'good' }),
  });

  const performance = await call('http://localhost:3000/api/user/performance', { headers });

  console.log(JSON.stringify({
    signals_status: signals.status,
    personalized: signals.body?.personalized,
    signals_count: Array.isArray(signals.body?.signals) ? signals.body.signals.length : null,
    watchlist_status: watchlist.status,
    watchlist_count: Array.isArray(watchlist.body?.signals) ? watchlist.body.signals.length : null,
    feedback_status: feedback.status,
    performance_status: performance.status,
    performance: performance.body,
  }, null, 2));
}

run()
  .catch((error) => {
    console.error('SMOKE_FAIL', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {
      // no-op
    }
  });
