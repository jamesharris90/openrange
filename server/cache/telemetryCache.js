const { getCache, setCache, DEFAULT_TTLS } = require('./redisClient');

const CACHE_KEY = 'openrange:telemetry';

function baseTelemetry() {
  return {
    pipeline_runtime: null,
    ingestion_runtime: null,
    integrity_runtime: null,
    flow_runtime: null,
    squeeze_runtime: null,
    opportunity_runtime: null,
    provider_health: {},
    last_update: null,
    cache_hits: 0,
    cache_misses: 0,
    event_bus_throughput: 0,
    events_per_second: 0,
    queue_depth: 0,
    avg_engine_runtime: 0,
  };
}

async function readTelemetry() {
  const current = await getCache(CACHE_KEY);
  if (!current || typeof current !== 'object') return baseTelemetry();
  return { ...baseTelemetry(), ...current };
}

async function updateTelemetry(engine, data = {}) {
  const telemetry = await readTelemetry();

  telemetry[String(engine)] = {
    ...(telemetry[String(engine)] || {}),
    ...(data || {}),
    updated_at: new Date().toISOString(),
  };

  telemetry.last_update = new Date().toISOString();

  const runtimes = [
    telemetry.pipeline_runtime?.runtime_ms,
    telemetry.ingestion_runtime?.runtime_ms,
    telemetry.integrity_runtime?.runtime_ms,
    telemetry.flow_runtime?.runtime_ms,
    telemetry.squeeze_runtime?.runtime_ms,
    telemetry.opportunity_runtime?.runtime_ms,
  ].filter((v) => Number.isFinite(Number(v)));

  telemetry.avg_engine_runtime = runtimes.length
    ? Number((runtimes.reduce((sum, n) => sum + Number(n), 0) / runtimes.length).toFixed(2))
    : 0;

  await setCache(CACHE_KEY, telemetry, DEFAULT_TTLS.engineTelemetry);
  return telemetry;
}

async function getTelemetry() {
  const telemetry = await readTelemetry();
  return telemetry;
}

async function markCacheHit() {
  const telemetry = await readTelemetry();
  telemetry.cache_hits = Number(telemetry.cache_hits || 0) + 1;
  telemetry.last_update = new Date().toISOString();
  await setCache(CACHE_KEY, telemetry, DEFAULT_TTLS.engineTelemetry);
}

async function markCacheMiss() {
  const telemetry = await readTelemetry();
  telemetry.cache_misses = Number(telemetry.cache_misses || 0) + 1;
  telemetry.last_update = new Date().toISOString();
  await setCache(CACHE_KEY, telemetry, DEFAULT_TTLS.engineTelemetry);
}

module.exports = {
  updateTelemetry,
  getTelemetry,
  markCacheHit,
  markCacheMiss,
};
