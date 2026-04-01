const cache = Object.create(null);

function setCache(key, data, ttlMs = 60000) {
  cache[key] = {
    data,
    expiry: Date.now() + ttlMs,
  };
}

function getCache(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

module.exports = {
  setCache,
  getCache,
};