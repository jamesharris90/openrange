const db = require('../db');

const store = {
  total: 0,
  perUser: new Map(),
  perPath: new Map(),
  perMinute: [], // rolling window entries { ts, user, path }
};

function record(path, user) {
  const now = Date.now();
  store.total += 1;
  const u = user || 'anon';
  store.perUser.set(u, (store.perUser.get(u) || 0) + 1);
  store.perPath.set(path, (store.perPath.get(path) || 0) + 1);
  store.perMinute.push({ ts: now, user: u, path });
  prune(now);
  // Fire-and-forget persistence
  db.recordUsage({ user: u, path, ts: now }).catch(() => {});
}

function prune(now = Date.now()) {
  const cutoff = now - 60 * 1000;
  while (store.perMinute.length && store.perMinute[0].ts < cutoff) {
    store.perMinute.shift();
  }
}

function snapshot() {
  prune();
  const rpm = store.perMinute.length;
  const perUserRpm = {};
  store.perMinute.forEach(e => { perUserRpm[e.user] = (perUserRpm[e.user] || 0) + 1; });
  const topPaths = Array.from(store.perPath.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topUsers = Array.from(store.perUser.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return {
    total: store.total,
    rpm,
    topPaths,
    topUsers,
    perUserRpm,
  };
}

module.exports = { record, snapshot };
