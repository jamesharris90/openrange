const cacheStore = new Map();

function nowMs() {
  return Date.now();
}

function getCachedValue(key) {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  return entry.value;
}

function isFresh(key, ttlMs) {
  const entry = cacheStore.get(key);
  if (!entry) return false;
  return nowMs() - entry.ts <= ttlMs;
}

function setCachedValue(key, value) {
  cacheStore.set(key, {
    ts: nowMs(),
    value,
  });
}

function getCacheMeta(key) {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  return {
    ts: entry.ts,
    ageMs: nowMs() - entry.ts,
  };
}

module.exports = {
  getCachedValue,
  isFresh,
  setCachedValue,
  getCacheMeta,
};
