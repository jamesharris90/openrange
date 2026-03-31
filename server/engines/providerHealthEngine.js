const logger = require('../logger');
const eventBus = require('../events/eventBus');
const EVENT_TYPES = require('../events/eventTypes');
const { updateTelemetry } = require('../cache/telemetryCache');
const { queryWithTimeout } = require('../db/pg');
const { providerRequest } = require('../utils/providerRequest');

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
    const response = await providerRequest(provider.url, {
      timeout: 8000,
      validateStatus: () => true,
      rawResponse: true,
    });
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
  const snapshot = getProviderHealth();

  await updateTelemetry('provider_health', {
    status: 'ok',
    providers: snapshot.providers,
    checked_at: snapshot.checked_at,
  });

  await queryWithTimeout(
    `INSERT INTO provider_health (provider, status, latency, created_at)
     SELECT x.provider, x.status, x.latency, NOW()
     FROM jsonb_to_recordset($1::jsonb) AS x(provider text, status text, latency numeric)`,
    [JSON.stringify(Object.values(snapshot.providers || {}).map((p) => ({ provider: p.provider, status: p.status, latency: p.latency })))],
    { timeoutMs: 3000, label: 'provider_health.insert', maxRetries: 0 }
  ).catch(() => null);

  return snapshot;
}

function getProviderHealth() {
  return {
    checked_at: state.checked_at,
    providers: state.providers,
  };
}

// ── Validation-log-based reliability scoring ──────────────────────────────────

/**
 * Computes data reliability score for a provider from data_validation_log.
 * reliability_score = 1 - (price_mismatches / total_rejections)
 */
async function getValidationReliability(provider = 'fmp', hours = 24) {
  try {
    const res = await queryWithTimeout(
      `SELECT
         COUNT(*)::int                                                   AS total,
         COUNT(*) FILTER (WHERE issue = 'price_mismatch')::int          AS mismatches,
         COUNT(*) FILTER (WHERE issue = 'stale_data')::int              AS stale,
         COUNT(*) FILTER (WHERE issue = 'invalid_price')::int           AS invalid_price,
         COUNT(*) FILTER (WHERE issue = 'invalid_volume')::int          AS invalid_volume,
         COUNT(*) FILTER (WHERE issue LIKE 'extreme_%')::int            AS extreme_values,
         COUNT(*) FILTER (WHERE issue = 'volume_spike_unconfirmed')::int AS volume_spikes,
         COUNT(DISTINCT symbol)::int                                     AS unique_symbols_rejected,
         MAX(created_at)                                                 AS last_rejection
       FROM data_validation_log
       WHERE created_at > NOW() - ($2 || ' hours')::interval
         AND provider = $1`,
      [provider, String(hours)],
      { timeoutMs: 8000, label: 'provider_health.validation_reliability', maxRetries: 0 }
    );
    const row = res.rows?.[0] || {};
    const total      = Number(row.total      || 0);
    const mismatches = Number(row.mismatches || 0);
    const reliabilityScore = total > 0
      ? Number((1 - (mismatches / total)).toFixed(4))
      : 1.0;
    return {
      provider,
      reliability_score:       reliabilityScore,
      mismatches_24h:          mismatches,
      stale_24h:               Number(row.stale          || 0),
      invalid_price_24h:       Number(row.invalid_price  || 0),
      invalid_volume_24h:      Number(row.invalid_volume || 0),
      extreme_values_24h:      Number(row.extreme_values || 0),
      volume_spikes_24h:       Number(row.volume_spikes  || 0),
      total_checked_24h:       total,
      unique_symbols_rejected: Number(row.unique_symbols_rejected || 0),
      last_rejection:          row.last_rejection || null,
    };
  } catch (err) {
    logger.warn('[PROVIDER_HEALTH] validation reliability query failed', { error: err.message });
    return { provider, reliability_score: null, error: err.message };
  }
}

/**
 * Top N most-rejected symbols in the last N hours.
 */
async function getWorstSymbols(hours = 24, limit = 5) {
  try {
    const res = await queryWithTimeout(
      `SELECT symbol,
              COUNT(*)::int             AS rejection_count,
              array_agg(DISTINCT issue) AS issues
       FROM data_validation_log
       WHERE created_at > NOW() - ($1 || ' hours')::interval
       GROUP BY symbol
       ORDER BY rejection_count DESC
       LIMIT $2`,
      [String(hours), limit],
      { timeoutMs: 8000, label: 'provider_health.worst_symbols', maxRetries: 0 }
    );
    return (res.rows || []).map((r) => ({
      symbol:          r.symbol,
      rejection_count: r.rejection_count,
      issues:          r.issues || [],
    }));
  } catch (err) {
    logger.warn('[PROVIDER_HEALTH] worst symbols query failed', { error: err.message });
    return [];
  }
}

/**
 * Top N most common validation issues in the last N hours.
 */
async function getTopIssues(hours = 24, limit = 5) {
  try {
    const res = await queryWithTimeout(
      `SELECT issue, COUNT(*)::int AS count
       FROM data_validation_log
       WHERE created_at > NOW() - ($1 || ' hours')::interval
       GROUP BY issue
       ORDER BY count DESC
       LIMIT $2`,
      [String(hours), limit],
      { timeoutMs: 8000, label: 'provider_health.top_issues', maxRetries: 0 }
    );
    return (res.rows || []).map((r) => ({ issue: r.issue, count: r.count }));
  } catch (err) {
    logger.warn('[PROVIDER_HEALTH] top issues query failed', { error: err.message });
    return [];
  }
}

module.exports = {
  runProviderHealthCheck,
  getProviderHealth,
  getValidationReliability,
  getWorstSymbols,
  getTopIssues,
};
