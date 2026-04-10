/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const pool = require('../server/db/pool');

dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

const TARGET_TABLES = ['news_articles', 'earnings_calendar', 'ipo_calendar', 'stock_splits'];

function ensureDir(rel) {
  const dir = path.resolve(process.cwd(), rel);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function getColumns(pool, table) {
  const q = await pool.query(
    `select column_name, data_type
     from information_schema.columns
     where table_schema='public' and table_name=$1
     order by ordinal_position`,
    [table]
  );
  return q.rows;
}

async function getCount(pool, table) {
  const q = await pool.query(`select count(*)::int as c from ${table}`);
  return Number(q.rows[0]?.c || 0);
}

async function getTimestampDiagnostics(pool, table, timestampCol) {
  if (!timestampCol) {
    return { timestamp_column: null, non_null: 0, min: null, max: null, valid: false };
  }

  const q = await pool.query(
    `select
       count(*) filter (where ${timestampCol} is not null)::int as non_null,
       min(${timestampCol}) as min,
       max(${timestampCol}) as max
     from ${table}`
  );

  const row = q.rows[0] || {};
  return {
    timestamp_column: timestampCol,
    non_null: Number(row.non_null || 0),
    min: row.min || null,
    max: row.max || null,
    valid: Number(row.non_null || 0) > 0,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL missing in server/.env');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    blockingGate: 'step1_database_schema_validation',
    tables: {},
    concentration: {},
    checks: {
      rowsPositive: true,
      symbolPresence: true,
      timestampValidity: true,
      noAaplDominance: true,
    },
    failedChecks: [],
    ok: true,
  };

  try {
    for (const table of TARGET_TABLES) {
      const columns = await getColumns(pool, table);
      const count = await getCount(pool, table);
      const colNames = columns.map((c) => c.column_name);

      const symbolExpected = table !== 'news_articles' || colNames.includes('symbol');
      const hasSymbol = colNames.includes('symbol');

      const timestampCandidates = ['published_date', 'event_date', 'created_at', 'published_at', 'ingested_at'];
      const timestampCol = timestampCandidates.find((c) => colNames.includes(c)) || null;
      const ts = await getTimestampDiagnostics(pool, table, timestampCol);

      report.tables[table] = {
        rowCount: count,
        columns: colNames,
        symbolExpected,
        symbolPresent: hasSymbol,
        timestamp: ts,
      };

      if (count <= 0) {
        report.checks.rowsPositive = false;
      }
      if (symbolExpected && !hasSymbol) {
        report.checks.symbolPresence = false;
      }
      if (!ts.valid) {
        report.checks.timestampValidity = false;
      }
    }

    const concentrationQueries = {
      news_articles: `
        with c as (
          select symbol, count(*)::int as n
          from news_articles
          where symbol is not null and symbol <> ''
          group by symbol
        )
        select
          coalesce(sum(n),0)::int as total,
          coalesce(max(n),0)::int as top_count,
          coalesce((array_agg(symbol order by n desc))[1], null) as top_symbol
        from c
      `,
      earnings_calendar: `
        with c as (
          select symbol, count(*)::int as n
          from earnings_calendar
          where symbol is not null and symbol <> ''
          group by symbol
        )
        select
          coalesce(sum(n),0)::int as total,
          coalesce(max(n),0)::int as top_count,
          coalesce((array_agg(symbol order by n desc))[1], null) as top_symbol
        from c
      `,
      ipo_calendar: `
        with c as (
          select symbol, count(*)::int as n
          from ipo_calendar
          where symbol is not null and symbol <> ''
          group by symbol
        )
        select
          coalesce(sum(n),0)::int as total,
          coalesce(max(n),0)::int as top_count,
          coalesce((array_agg(symbol order by n desc))[1], null) as top_symbol
        from c
      `,
      stock_splits: `
        with c as (
          select symbol, count(*)::int as n
          from stock_splits
          where symbol is not null and symbol <> ''
          group by symbol
        )
        select
          coalesce(sum(n),0)::int as total,
          coalesce(max(n),0)::int as top_count,
          coalesce((array_agg(symbol order by n desc))[1], null) as top_symbol
        from c
      `,
    };

    for (const [table, sql] of Object.entries(concentrationQueries)) {
      const q = await pool.query(sql);
      const row = q.rows[0] || {};
      const total = Number(row.total || 0);
      const topCount = Number(row.top_count || 0);
      const topShare = total > 0 ? topCount / total : 0;

      report.concentration[table] = {
        total,
        topSymbol: row.top_symbol || null,
        topCount,
        topShare,
        pass: topShare <= 0.3,
      };

      if (topShare > 0.3) {
        report.checks.noAaplDominance = false;
      }
    }

    for (const [check, ok] of Object.entries(report.checks)) {
      if (!ok) report.failedChecks.push(check);
    }

    report.ok = report.failedChecks.length === 0;

    ensureDir('logs/intelligence');
    const out = path.resolve(process.cwd(), 'logs/intelligence/step1-db-audit.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
    console.log(`Wrote ${out}`);

    if (!report.ok) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
