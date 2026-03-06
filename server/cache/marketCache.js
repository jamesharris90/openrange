const cache = {};
const TTL = 60 * 1000;

function get(key) {
  const entry = cache[key];

  if (!entry) return null;

  if (Date.now() > entry.expiry) {
    delete cache[key];
    return null;
  }

  return entry.value;
}

function set(key, value) {
  cache[key] = {
    value,
    expiry: Date.now() + TTL,
  };
}

module.exports = { get, set };
