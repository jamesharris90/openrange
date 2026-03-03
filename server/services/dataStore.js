// In-memory universe cache store for screener data.

let universeCache = {
  data: [],
  lastUpdated: null,
};

function isCacheFresh(minutes) {
  if (!universeCache.lastUpdated) return false;
  return (Date.now() - universeCache.lastUpdated) < minutes * 60 * 1000;
}

function setUniverse(data) {
  universeCache.data = Array.isArray(data) ? data : [];
  universeCache.lastUpdated = Date.now();
}

function getUniverse() {
  return universeCache.data;
}

function getLastUpdated() {
  return universeCache.lastUpdated;
}

module.exports = {
  isCacheFresh,
  setUniverse,
  getUniverse,
  getLastUpdated,
};

