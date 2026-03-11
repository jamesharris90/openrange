const Redis = require('ioredis');
const logger = require('../logger');

const DEFAULT_TTLS = Object.freeze({
  ticker: 20,
  sparkline: 60,
  engineTelemetry: 15,
  providerHealth: 60,
});

const memoryStore = new Map();

let redis = null;
let redisAvailable = false;
let warnedMissingConfig = false;
let warnedUnavailable = false;

function buildRedisClient() {
  const redisUrl = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;
  const port = Number(process.env.REDIS_PORT || 6379);

  if (!redisUrl && !host) return null;

  if (redisUrl) {
    return new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  return new Redis({
    host,
    port,
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

async function initRedis() {
  if (redis) return;
  redis = buildRedisClient();
  if (!redis) {
    if (!warnedMissingConfig) {
      logger.warn('[CACHE] Redis config missing, using memory fallback');
      warnedMissingConfig = true;
    }
    return;
  }

  try {
    await redis.connect();
    redisAvailable = true;
    logger.info('[CACHE] Redis connected');
  } catch (error) {
    redisAvailable = false;
    if (!warnedUnavailable) {
      logger.warn('[CACHE] Redis unavailable, using memory fallback', { error: error.message });
      warnedUnavailable = true;
    }
  }
}

function setMemoryCache(key, value, ttlSeconds) {
  const expiresAt = Date.now() + Math.max(1, Number(ttlSeconds || 1)) * 1000;
  memoryStore.set(String(key), { value, expiresAt });
}

function getMemoryCache(key) {
  const entry = memoryStore.get(String(key));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(String(key));
    return null;
  }
  return entry.value;
}

async function getCache(key) {
  await initRedis();
  const normalizedKey = String(key);

  if (redisAvailable && redis) {
    try {
      const raw = await redis.get(normalizedKey);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      logger.warn('[CACHE] Redis get failed, using memory fallback', { key: normalizedKey, error: error.message });
      redisAvailable = false;
    }
  }

  return getMemoryCache(normalizedKey);
}

async function setCache(key, value, ttlSeconds = DEFAULT_TTLS.engineTelemetry) {
  await initRedis();
  const normalizedKey = String(key);
  const ttl = Math.max(1, Number(ttlSeconds || DEFAULT_TTLS.engineTelemetry));

  if (redisAvailable && redis) {
    try {
      await redis.set(normalizedKey, JSON.stringify(value), 'EX', ttl);
      return true;
    } catch (error) {
      logger.warn('[CACHE] Redis set failed, using memory fallback', { key: normalizedKey, error: error.message });
      redisAvailable = false;
    }
  }

  setMemoryCache(normalizedKey, value, ttl);
  return true;
}

async function deleteCache(key) {
  await initRedis();
  const normalizedKey = String(key);

  if (redisAvailable && redis) {
    try {
      await redis.del(normalizedKey);
      return true;
    } catch (error) {
      logger.warn('[CACHE] Redis delete failed', { key: normalizedKey, error: error.message });
      redisAvailable = false;
    }
  }

  memoryStore.delete(normalizedKey);
  return true;
}

module.exports = {
  getCache,
  setCache,
  deleteCache,
  DEFAULT_TTLS,
  initRedis,
};
