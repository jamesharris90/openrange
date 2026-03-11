const axios = require('axios');
const logger = require('../logger');
const eventBus = require('../events/eventBus');
const EVENT_TYPES = require('../events/eventTypes');

const PROVIDERS = [
  {
    key: 'fmp',
    url: 'https://financialmodelingprep.com/stable/quote?symbol=AAPL',
  },
  {
    key: 'finnhub',
    url: 'https://finnhub.io/api/v1/quote?symbol=AAPL',
  },
  {
    key: 'polygon',
    url: 'https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/2025-01-02/2025-01-03',
  },
  {
    key: 'finviz',
    url: 'https://elite.finviz.com/news_export.ashx?v=1',
  },
];

const state = {
  providers: {
    fmp: { provider: 'fmp', status: 'unknown', latency: null, last_success: null, error_rate: 0, errors: 0, checks: 0 },
    finnhub: { provider: 'finnhub', status: 'unknown', latency: null, last_success: null, error_rate: 0, errors: 0, checks: 0 },
    polygon: { provider: 'polygon', status: 'unknown', latency: null, last_success: null, error_rate: 0, errors: 0, checks: 0 },
    finviz: { provider: 'finviz', status: 'unknown', latency: null, last_success: null, error_rate: 0, errors: 0, checks: 0 },
  },
  checked_at: null,
};

async function probeProvider(provider) {
  const startedAt = Date.now();
  const entry = state.providers[provider.key];
  entry.checks += 1;

  try {
    const response = await axios.get(provider.url, { timeout: 8000, validateStatus: () => true });
    entry.latency = Date.now() - startedAt;
    if (response.status >= 200 && response.status < 500) {
      entry.status = 'ok';
      entry.last_success = new Date().toISOString();
    } else {
      entry.status = 'warning';
      entry.errors += 1;
      eventBus.emit(EVENT_TYPES.PROVIDER_FAILURE, {
        source: 'provider_health_engine',
        provider: provider.key,
        issue: 'provider_http_failure',
        severity: 'high',
        status_code: response.status,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    entry.latency = Date.now() - startedAt;
    entry.status = 'warning';
    entry.errors += 1;
    eventBus.emit(EVENT_TYPES.PROVIDER_FAILURE, {
      source: 'provider_health_engine',
      provider: provider.key,
      issue: 'provider_request_failure',
      severity: 'high',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    logger.warn('[PROVIDER_HEALTH] probe failed', { provider: provider.key, error: error.message });
  }

  entry.error_rate = entry.checks ? Number((entry.errors / entry.checks).toFixed(4)) : 0;
  return entry;
}

async function runProviderHealthCheck() {
  await Promise.all(PROVIDERS.map((provider) => probeProvider(provider)));
  state.checked_at = new Date().toISOString();
  return getProviderHealth();
}

function getProviderHealth() {
  return {
    checked_at: state.checked_at,
    providers: state.providers,
  };
}

module.exports = {
  runProviderHealthCheck,
  getProviderHealth,
};
