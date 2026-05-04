require('../node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { queryWithTimeout } = require('../db/pg');

const OUT_PATH = '/tmp/intraday_corruption_diagnosis.md';
const AUDIT_DATES = [
  '2026-04-08',
  '2026-04-09',
  '2026-04-10',
  '2026-04-14',
  '2026-04-15',
  '2026-04-16',
  '2026-04-17',
  '2026-04-29',
];

async function runQuery(label, sql, params = [], timeoutMs = 30000) {
  const result = await queryWithTimeout(sql, params, {
    label,
    timeoutMs,
    maxRetries: 0,
    poolType: 'read',
  });
  return result.rows || [];
}

function toTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '_No rows returned._';
  }
  const headers = Object.keys(rows[0]);
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];

  for (const row of rows) {
    lines.push(`| ${headers.map((key) => String(row[key] ?? '')).join(' | ')} |`);
  }

  return lines.join('\n');
}

async function main() {
  const totalBars = await runQuery(
    'diag.intraday.total_bars',
    `SELECT COUNT(*)::bigint AS total_bars FROM intraday_1m`
  );

  const barsPerHour = await runQuery(
    'diag.intraday.bars_per_et_hour',
    `SELECT
       EXTRACT(HOUR FROM (timestamp AT TIME ZONE 'America/New_York'))::int AS et_hour,
       COUNT(*)::bigint AS bars
     FROM intraday_1m
     GROUP BY et_hour
     ORDER BY et_hour`
  );

  const sampleShift = await runQuery(
    'diag.intraday.sample_shift',
    `WITH latest_symbols AS (
       SELECT DISTINCT symbol
       FROM intraday_1m
       WHERE session = 'PREMARKET'
         AND timestamp::date = CURRENT_DATE
       ORDER BY symbol ASC
       LIMIT 5
     )
     SELECT
       i.symbol,
       i.timestamp AS stored_timestamp_utc,
       (i.timestamp AT TIME ZONE 'America/New_York') AS stored_timestamp_et,
       (i.timestamp + INTERVAL '4 hours') AS corrected_timestamp_utc,
       ((i.timestamp + INTERVAL '4 hours') AT TIME ZONE 'America/New_York') AS corrected_timestamp_et
     FROM intraday_1m i
     INNER JOIN latest_symbols s ON s.symbol = i.symbol
     WHERE i.session = 'PREMARKET'
       AND i.timestamp::date = CURRENT_DATE
     ORDER BY i.symbol ASC, i.timestamp DESC
     LIMIT 15`
  );

  const auditImpact = [];
  for (const tradingDay of AUDIT_DATES) {
    const rows = await runQuery(
      `diag.intraday.audit_impact.${tradingDay}`,
      `SELECT
         $1::date AS trading_day,
         COUNT(*) FILTER (
           WHERE session = 'PREMARKET'
             AND timestamp >= ($1::timestamp + TIME '08:00') AT TIME ZONE 'America/New_York'
             AND timestamp < ($1::timestamp + TIME '09:00') AT TIME ZONE 'America/New_York'
         )::bigint AS stored_08_09_et_bars,
         COUNT(DISTINCT symbol) FILTER (
           WHERE session = 'PREMARKET'
             AND timestamp >= ($1::timestamp + TIME '08:00') AT TIME ZONE 'America/New_York'
             AND timestamp < ($1::timestamp + TIME '09:00') AT TIME ZONE 'America/New_York'
         )::bigint AS stored_08_09_et_symbols,
         COUNT(*) FILTER (
           WHERE session = 'PREMARKET'
             AND timestamp >= ($1::timestamp + TIME '04:00') AT TIME ZONE 'America/New_York'
             AND timestamp < ($1::timestamp + TIME '05:00') AT TIME ZONE 'America/New_York'
         )::bigint AS shifted_04_05_et_bars,
         COUNT(DISTINCT symbol) FILTER (
           WHERE session = 'PREMARKET'
             AND timestamp >= ($1::timestamp + TIME '04:00') AT TIME ZONE 'America/New_York'
             AND timestamp < ($1::timestamp + TIME '05:00') AT TIME ZONE 'America/New_York'
         )::bigint AS shifted_04_05_et_symbols
       FROM intraday_1m
       WHERE timestamp >= ($1::timestamp + TIME '04:00') AT TIME ZONE 'America/New_York'
         AND timestamp < ($1::timestamp + TIME '09:00') AT TIME ZONE 'America/New_York'`,
      [tradingDay],
      20000
    );
    auditImpact.push(rows[0]);
  }

  const auditWindowSummary = [
    {
      audit_days_checked: auditImpact.length,
      days_with_stored_08_09_bars: auditImpact.filter((row) => Number(row.stored_08_09_et_bars || 0) > 0).length,
      days_with_shifted_04_05_bars: auditImpact.filter((row) => Number(row.shifted_04_05_et_bars || 0) > 0).length,
      total_stored_08_09_bars: auditImpact.reduce((sum, row) => sum + Number(row.stored_08_09_et_bars || 0), 0),
      total_shifted_04_05_bars: auditImpact.reduce((sum, row) => sum + Number(row.shifted_04_05_et_bars || 0), 0),
    },
  ];

  const sections = [
    '# Intraday Corruption Diagnosis',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Total Bars',
    '',
    toTable(totalBars),
    '',
    '## Bars Per ET Hour',
    '',
    toTable(barsPerHour),
    '',
    '## Sample PREMARKET Shift (Stored vs +4h Corrected)',
    '',
    toTable(sampleShift),
    '',
    '## Audit-Date Window Summary',
    '',
    toTable(auditWindowSummary),
    '',
    '## Audit-Date Impact',
    '',
    toTable(auditImpact),
    '',
  ];

  const report = sections.join('\n');
  fs.writeFileSync(OUT_PATH, report);
  process.stdout.write(report);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});