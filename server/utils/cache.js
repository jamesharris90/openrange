const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
};

const store = new Map();

function set(key, value, ttlMs) {
  const expires = ttlMs ? Date.now() + ttlMs : null;
  store.set(key, { value, expires });
  stats.sets += 1;
}

function get(key) {
  const entry = store.get(key);
  if (!entry) {
    stats.misses += 1;
    return null;
  }
  if (entry.expires && entry.expires < Date.now()) {
    store.delete(key);
    stats.misses += 1;
    return null;
  }
  stats.hits += 1;
  return entry.value;
}

function del(key) {
  store.delete(key);
}

function clear() {
  store.clear();
}

function getStats() {
  return {
    ...stats,
    size: store.size,
  };
}

module.exports = {
  set,
  get,
  del,
  clear,
  getStats,
};
