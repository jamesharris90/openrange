const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../server/.env') });

const { queryWithTimeout } = require('../server/db/pg');
const { runEngineDiagnostics } = require('../server/system/engineDiagnostics');

async function getDbCounts() {
  const tables = ['intraday_1m', 'market_quotes', 'news_articles', 'opportunity_stream', 'sparkline_cache'];
  const out = [];
  for (const table of tables) {
    try {
      const { rows } = await queryWithTimeout(`SELECT COUNT(*)::bigint AS rows FROM ${table}`, [], {
        timeoutMs: 7000,
        label: `stability_report.count.${table}`,
        maxRetries: 0,
      });
      out.push({ table, rows: Number(rows?.[0]?.rows || 0) });
    } catch (error) {
      out.push({ table, rows: 0, error: error.message });
    }
  }
  return out;
}

async function getErrorSummary() {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT timestamp, engine, message
       FROM engine_errors
       ORDER BY timestamp DESC
       LIMIT 50`,
      [],
      { timeoutMs: 7000, label: 'stability_report.engine_errors', maxRetries: 0 }
    );
    const dbErrors = (rows || []).map((r) => ({ timestamp: r.timestamp, engine: r.engine, message: r.message }));
    if (dbErrors.length) return dbErrors;
  } catch {
    // Fall through to log parsing fallback.
  }

  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '../server/logs/combined.log'), 'utf8');
    const parsed = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((entry) => String(entry.level || '').toLowerCase() === 'error')
      .slice(-50)
      .map((entry) => ({
        timestamp: entry.timestamp || null,
        engine: entry.engine || 'system',
        message: entry.error || entry.message || null,
      }));
    return parsed;
  } catch {
    return [];
  }
}

async function main() {
  const diagnostics = await runEngineDiagnostics();
  const providers = diagnostics.provider_health?.providers || {};
  const cache = diagnostics.cache_health || {};

  const report = {
    system_info: {
      node_version: process.version,
      npm_version: execSync('npm -v').toString().trim(),
      git_commit: execSync('git rev-parse HEAD').toString().trim(),
      build_time: new Date().toISOString(),
    },
    engine_health: {
      pipeline: diagnostics.engines?.pipeline || null,
      stocks_in_play: diagnostics.engines?.stocks_in_play || null,
      squeeze: diagnostics.engines?.short_squeeze || null,
      flow: diagnostics.engines?.flow_detection || null,
      opportunity: diagnostics.engines?.opportunity || null,
      narrative: diagnostics.engines?.market_narrative || null,
    },
    provider_health: {
      fmp: providers.fmp || null,
      finnhub: providers.finnhub || null,
      polygon: providers.polygon || null,
      finviz: providers.finviz || null,
    },
    database_health: await getDbCounts(),
    cache_health: {
      ticker_cache_status: cache.ticker_cache || 'unknown',
      sparkline_cache_rows: cache.sparkline_cache_rows || 0,
      cache_refresh_time: cache.cache_refresh_time || null,
    },
    error_summary: await getErrorSummary(),
  };

  fs.writeFileSync(path.resolve(__dirname, '../system-stability-report.json'), JSON.stringify(report, null, 2));
  console.log('Wrote system-stability-report.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
