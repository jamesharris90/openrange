const express = require('express');
const fs = require('fs');
const path = require('path');

const { getSnapshotStatus } = require('../services/snapshotService');
const { queryWithTimeout } = require('../../db/pg');
const { getDataHealth } = require('../../system/dataHealthEngine');
const { getDataIntegrityHealth } = require('../../engines/dataIntegrityEngine');
const { readCoverageCampaignState } = require('../../services/coverageCampaignStateStore');
const { getDataTrustSnapshot, getGlobalDataTrustHealth } = require('../../services/dataTrustService');
const { getCoverageExplanation, getGlobalCoverageHealth } = require('../../services/dataCoverageService');

const router = express.Router();
const cronLogPath = path.resolve(__dirname, '../../logs/cron.log');

const DEFAULT_TIMESTAMP_COLUMNS = ['updated_at', 'created_at', 'timestamp', 'published_at', 'report_date', 'as_of_date'];

const TABLE_CONFIG = [
  { alias: 'intraday_1m', table: 'intraday_1m', timestampColumns: ['timestamp', 'updated_at', 'created_at'] },
  { alias: 'daily_ohlc', table: 'daily_ohlc', timestampColumns: ['date', 'updated_at', 'created_at'], thresholdMinutes: 2880 },
  { alias: 'ticker_universe', table: 'ticker_universe', timestampColumns: ['last_updated', 'created_at'], thresholdMinutes: 10080 },
  { alias: 'catalyst_signals', table: 'catalyst_signals', timestampColumns: ['created_at', 'updated_at'], thresholdMinutes: 120 },
  { alias: 'trade_outcomes', table: 'trade_outcomes', timestampColumns: ['evaluated_at', 'created_at'], thresholdMinutes: 10080 },
  { alias: 'technical_data', table: 'trade_setups', timestampColumns: ['updated_at', 'detected_at', 'created_at'] },
  { alias: 'news_articles', table: 'news_articles', timestampColumns: ['published_at', 'ingested_at', 'created_at'] },
  { alias: 'earnings_events', table: 'earnings_events', timestampColumns: ['report_date', 'updated_at', 'created_at'] },
  { alias: 'opportunity_stream', table: 'opportunity_stream', timestampColumns: ['updated_at', 'created_at'] },
];

async function loadTableMetadata(tableNames) {
  const result = await queryWithTimeout(
    `SELECT src.name,
            CASE WHEN ns.oid IS NULL THEN FALSE ELSE cls.oid IS NOT NULL END AS exists,
            GREATEST(0, ROUND(COALESCE(stats.n_live_tup, cls.reltuples, 0)))::bigint AS row_estimate
     FROM unnest($1::text[]) AS src(name)
     LEFT JOIN pg_class AS cls
       ON cls.relname = src.name
      AND cls.relkind = 'r'
     LEFT JOIN pg_namespace AS ns
       ON ns.oid = cls.relnamespace
      AND ns.nspname = 'public'
     LEFT JOIN pg_stat_user_tables AS stats
       ON stats.relid = cls.oid`,
    [tableNames],
    { timeoutMs: 7000, label: 'v2.system.table_metadata', maxRetries: 0 }
  );

  return new Map(
    (result.rows || []).map((row) => [
      String(row.name || ''),
      {
        exists: Boolean(row.exists),
        rowEstimate: Number(row.row_estimate || 0),
      },
    ])
  );
}

function resolveTimestampColumn(config) {
  return (config.timestampColumns || DEFAULT_TIMESTAMP_COLUMNS)[0] || null;
}

async function loadLatestTimestamp(tableName, timestampColumn) {
  if (!timestampColumn) {
    return null;
  }

  const result = await queryWithTimeout(
    `SELECT ${timestampColumn}::text AS latest_timestamp
     FROM ${tableName}
     WHERE ${timestampColumn} IS NOT NULL
     ORDER BY ${timestampColumn} DESC
     LIMIT 1`,
    [],
    { timeoutMs: 4000, label: `v2.system.latest.${tableName}`, maxRetries: 0 }
  ).catch(() => ({ rows: [{ latest_timestamp: null }] }));

  return result.rows?.[0]?.latest_timestamp || null;
}

async function getTableSnapshot(config, metadataByTable) {
  const metadata = metadataByTable.get(config.table) || { exists: false, rowEstimate: 0 };
  if (!metadata.exists) {
    return {
      table: config.alias,
      source_table: config.table,
      row_count: 0,
      latest_timestamp: null,
      lag_minutes: null,
      freshness_threshold_minutes: config.thresholdMinutes || 1440,
      status: 'down',
    };
  }

  const timestampColumn = resolveTimestampColumn(config);
  const latestTimestamp = await loadLatestTimestamp(config.table, timestampColumn);
  const rowCount = Number(metadata.rowEstimate || 0);
  const parsedTs = latestTimestamp ? Date.parse(latestTimestamp) : NaN;
  const lagMinutes = Number.isFinite(parsedTs)
    ? Math.max(0, Math.round((Date.now() - parsedTs) / 60000))
    : null;
  const thresholdMinutes = config.thresholdMinutes || 1440;

  let status = 'ok';
  if (rowCount === 0) {
    status = 'warning';
  } else if (lagMinutes != null && lagMinutes > thresholdMinutes) {
    status = 'degraded';
  }

  return {
    table: config.alias,
    source_table: config.table,
    row_count: rowCount,
    latest_timestamp: latestTimestamp,
    lag_minutes: lagMinutes,
    freshness_threshold_minutes: thresholdMinutes,
    status,
  };
}

function normalizeIntegrityIssue(issue, index) {
  const severity = String(issue?.severity || 'warning').toLowerCase();
  return {
    severity: ['info', 'warning', 'critical'].includes(severity) ? severity : 'warning',
    type: String(issue?.source || 'integrity'),
    key: String(issue?.issue || issue?.symbol || `issue_${index + 1}`),
    message: String(issue?.issue || issue?.message || 'Integrity issue detected'),
    detail: issue?.detail || null,
    symbol: issue?.symbol || null,
  };
}

router.get('/snapshot-status', async (_req, res) => {
  try {
    const payload = await getSnapshotStatus();
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.get('/health', async (_req, res) => {
  try {
    const dataHealth = await getDataHealth().catch((error) => ({ status: 'warning', error: error.message, tables: {} }));

    const marketQuotes = Number(dataHealth?.tables?.market_quotes || 0);
    const intraday = Number(dataHealth?.tables?.intraday_1m || 0);

    return res.json({
      backend: 'ok',
      db: dataHealth?.status === 'ok' ? 'ok' : 'warning',
      quotes: marketQuotes > 0 ? 'ok' : 'warning',
      ohlc: intraday > 0 ? 'ok' : 'warning',
      checked_at: new Date().toISOString(),
      data: dataHealth,
    });
  } catch (error) {
    return res.status(500).json({
      backend: 'error',
      db: 'unknown',
      quotes: 'unknown',
      ohlc: 'unknown',
      error: error.message,
      checked_at: new Date().toISOString(),
    });
  }
});

router.get('/cron-status', async (_req, res) => {
  try {
    if (!fs.existsSync(cronLogPath)) {
      return res.json({
        status: 'OK',
        recent_runs: [],
      });
    }

    const logs = fs.readFileSync(cronLogPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-50)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean);

    return res.json({
      status: 'OK',
      recent_runs: logs,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'ERROR',
      error: error.message,
    });
  }
});

router.get('/data-integrity', async (_req, res) => {
  try {
    const tableNames = TABLE_CONFIG.map((config) => config.table);
    const [metadataByTable, integrityHealth] = await Promise.all([
      loadTableMetadata(tableNames),
      Promise.resolve(getDataIntegrityHealth()).catch(() => ({ status: 'idle', issues: [], last_run: null })),
    ]);

    const tableSnapshots = await Promise.all(
      TABLE_CONFIG.map((config) => getTableSnapshot(config, metadataByTable))
    );

    const issues = Array.isArray(integrityHealth?.issues)
      ? integrityHealth.issues.map(normalizeIntegrityIssue)
      : [];

    const tableStatus = tableSnapshots.some((table) => table.status === 'down')
      ? 'down'
      : tableSnapshots.some((table) => table.status === 'degraded' || table.status === 'warning')
        ? 'degraded'
        : 'ok';

    const integrityStatus = String(integrityHealth?.status || 'idle').toLowerCase();
    const overallStatus = integrityStatus === 'failed' || tableStatus === 'down'
      ? 'down'
      : (integrityStatus === 'warning' || tableStatus === 'degraded' || issues.length > 0)
        ? 'degraded'
        : 'ok';

    return res.json({
      status: overallStatus,
      checked_at: new Date().toISOString(),
      issues,
      tables: tableSnapshots,
      pipelines: [],
      data_quality: [],
      parity: {
        status: issues.length > 0 ? 'degraded' : 'ok',
        symbols: [],
      },
    });
  } catch (error) {
    return res.status(200).json({
      status: 'degraded',
      checked_at: new Date().toISOString(),
      issues: [
        {
          severity: 'critical',
          type: 'system',
          key: 'data_integrity_failed',
          message: error.message || 'Failed to build data integrity payload',
        },
      ],
      tables: [],
      pipelines: [],
      data_quality: [],
      parity: {
        status: 'degraded',
        symbols: [],
      },
    });
  }
});

router.get('/data-trust', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase();

    if (symbol) {
      const trust = await getDataTrustSnapshot(symbol);
      return res.json({
        ok: true,
        symbol,
        trust,
        checked_at: new Date().toISOString(),
      });
    }

    const health = await getGlobalDataTrustHealth();
    return res.json({
      ok: true,
      checked_at: new Date().toISOString(),
      ...health,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'data_trust_failed',
      checked_at: new Date().toISOString(),
    });
  }
});

router.get('/data-coverage', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase();

    if (symbol) {
      const coverage = await getCoverageExplanation(symbol);
      return res.json({
        ok: true,
        symbol,
        coverage,
        checked_at: new Date().toISOString(),
      });
    }

    const health = await getGlobalCoverageHealth();
    return res.json({
      ok: true,
      checked_at: new Date().toISOString(),
      ...health,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'data_coverage_failed',
      checked_at: new Date().toISOString(),
    });
  }
});

// ── Coverage Campaign Monitor ─────────────────────────────────────────────────

const BACKFILL_LOG_DIR = path.resolve(__dirname, '../../logs/backfill');
const CAMPAIGN_STATUS_PATH = path.join(BACKFILL_LOG_DIR, 'coverage_completion_campaign_status.json');
const CAMPAIGN_CHECKPOINT_PATH = path.join(BACKFILL_LOG_DIR, 'coverage_completion_campaign_checkpoint.json');
const CAMPAIGN_HOURLY_PATH = path.join(BACKFILL_LOG_DIR, 'coverage_completion_campaign_hourly.jsonl');
const CAMPAIGN_STDOUT_PATH = path.join(BACKFILL_LOG_DIR, 'coverage_completion_campaign.stdout.log');

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    return null;
  }
}

function readJsonlFile(filePath, maxLines = 100) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-maxLines);
    return lines.map((line) => {
      try { return JSON.parse(line); } catch (_e) { return null; }
    }).filter(Boolean);
  } catch (_e) {
    return [];
  }
}

function readStdoutTail(filePath, maxLines = 80) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-maxLines);
  } catch (_e) {
    return [];
  }
}

function fileInfo(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { exists: false, updatedAt: null, sizeBytes: 0 };
    }
    const stat = fs.statSync(filePath);
    return { exists: true, updatedAt: stat.mtime.toISOString(), sizeBytes: stat.size };
  } catch (_e) {
    return { exists: false, updatedAt: null, sizeBytes: 0 };
  }
}

router.get('/coverage-campaign', (_req, res) => {
  return (async () => {
    try {
      const sharedState = await readCoverageCampaignState(['status', 'checkpoint', 'hourly']).catch(() => ({}));
      const status = sharedState?.status?.payload || readJsonFile(CAMPAIGN_STATUS_PATH);
      const checkpoint = sharedState?.checkpoint?.payload || readJsonFile(CAMPAIGN_CHECKPOINT_PATH);
      const hourly = Array.isArray(sharedState?.hourly?.payload)
        ? sharedState.hourly.payload.slice(-200)
        : readJsonlFile(CAMPAIGN_HOURLY_PATH, 200);
      const stdoutTail = readStdoutTail(CAMPAIGN_STDOUT_PATH, 80);

      // Derive summary from first and last hourly entries
      const baseline = hourly[0] || null;
      const lastHourly = hourly[hourly.length - 1] || null;

      const baselineNews = baseline?.missing_news_count ?? null;
      const baselineEarnings = baseline?.missing_earnings_count ?? null;
      const currentNews = status?.postcheck?.missing_news_count ?? status?.missing_news_count ?? lastHourly?.missing_news_count ?? null;
      const currentEarnings = status?.postcheck?.missing_earnings_count ?? status?.missing_earnings_count ?? lastHourly?.missing_earnings_count ?? null;

      const newsPercent = (baselineNews !== null && currentNews !== null && baselineNews > 0)
        ? Number((((baselineNews - currentNews) / baselineNews) * 100).toFixed(1))
        : null;
      const earningsPercent = (baselineEarnings !== null && currentEarnings !== null && baselineEarnings > 0)
        ? Number((((baselineEarnings - currentEarnings) / baselineEarnings) * 100).toFixed(1))
        : null;

      return res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        status,
        checkpoint,
        summary: {
          baseline: {
            missingNewsCount: baselineNews,
            missingEarningsCount: baselineEarnings,
            generatedAt: baseline?.generated_at ?? null,
          },
          current: {
            missingNewsCount: currentNews,
            missingEarningsCount: currentEarnings,
            generatedAt: status?.generated_at ?? lastHourly?.generated_at ?? null,
          },
          completion: {
            newsPercent,
            earningsPercent,
          },
        },
        hourly,
        stdoutTail,
        files: {
          status: fileInfo(CAMPAIGN_STATUS_PATH),
          checkpoint: fileInfo(CAMPAIGN_CHECKPOINT_PATH),
          hourly: fileInfo(CAMPAIGN_HOURLY_PATH),
          stdout: fileInfo(CAMPAIGN_STDOUT_PATH),
        },
        source: {
          type: sharedState?.status?.payload || sharedState?.checkpoint?.payload || sharedState?.hourly?.payload ? 'database' : 'files',
          shared: {
            statusUpdatedAt: sharedState?.status?.updatedAt || null,
            checkpointUpdatedAt: sharedState?.checkpoint?.updatedAt || null,
            hourlyUpdatedAt: sharedState?.hourly?.updatedAt || null,
          },
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  })();
});

module.exports = router;