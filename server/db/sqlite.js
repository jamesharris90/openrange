// DB layer: PostgreSQL via Supabase (usage metrics + user model re-exports)
const { pool } = require('./pg');
const model = require('../users/model');

// Ensure usage table exists (idempotent, fire-and-forget)
pool.query(`CREATE TABLE IF NOT EXISTS usage_events (
  id SERIAL PRIMARY KEY,
  ts BIGINT NOT NULL,
  "user" TEXT,
  path TEXT
)`).catch(err => console.error('Usage table init error:', err.message));

async function createUser(username, email, password, is_admin = 0) {
  return model.register(username, email, password, is_admin);
}

async function getUser(identifier) {
  return model.findByUsernameOrEmail(identifier);
}

async function updateUser(id, updates) {
  return model.updateUser(id, updates);
}

async function recordUsage({ user, path: apiPath, ts }) {
  const now = ts || Date.now();
  try {
    await pool.query(
      'INSERT INTO usage_events (ts, "user", path) VALUES ($1, $2, $3)',
      [now, user || 'anon', apiPath || 'unknown']
    );
    // Prune old entries (older than 30 days)
    await pool.query('DELETE FROM usage_events WHERE ts < $1', [now - 30 * 24 * 60 * 60 * 1000]);
    return true;
  } catch (err) {
    return false;
  }
}

async function getUsage({ minutes = 60, limit = 10 } = {}) {
  const since = Date.now() - minutes * 60 * 1000;
  const usageSummary = { windowMinutes: minutes, total: 0, perUser: [], perPath: [] };
  try {
    const totalR = await pool.query('SELECT COUNT(*) as c FROM usage_events WHERE ts >= $1', [since]);
    usageSummary.total = parseInt(totalR.rows[0]?.c || 0);

    const perUserR = await pool.query(
      'SELECT "user", COUNT(*) as c FROM usage_events WHERE ts >= $1 GROUP BY "user" ORDER BY c DESC LIMIT $2',
      [since, limit]
    );
    usageSummary.perUser = perUserR.rows;

    const perPathR = await pool.query(
      'SELECT path, COUNT(*) as c FROM usage_events WHERE ts >= $1 GROUP BY path ORDER BY c DESC LIMIT $2',
      [since, limit]
    );
    usageSummary.perPath = perPathR.rows;
  } catch (err) {
    // Swallow -- metrics should not break requests
  }
  return usageSummary;
}

module.exports = { createUser, getUser, updateUser, recordUsage, getUsage };
