/* eslint-disable no-console */
// @ts-nocheck

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "server/.env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE === "true" ? false : { rejectUnauthorized: false },
});

function ensureDir(relPath: string) {
  const dir = path.resolve(process.cwd(), relPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function run() {
  const report: any = {
    generatedAt: new Date().toISOString(),
    checks: {
      earnings: {},
      news: {},
      ipos: {},
      splits: {},
    },
    failedValidations: [],
  };

  const earnings = await pool.query(
    `SELECT symbol, event_date, eps_estimate, eps_actual,
            CASE
              WHEN eps_estimate IS NULL OR eps_estimate = 0 OR eps_actual IS NULL THEN NULL
              ELSE ABS((eps_actual - eps_estimate) / eps_estimate)
            END AS surprise_ratio
     FROM earnings_calendar
     WHERE event_date >= CURRENT_DATE - INTERVAL '90 days'`
  );

  const earningsSurprises = earnings.rows.filter((r: any) => Number(r.surprise_ratio) > 0.2);
  report.checks.earnings = {
    rowsEvaluated: earnings.rows.length,
    surprisesAbove20pct: earningsSurprises.length,
    sample: earningsSurprises.slice(0, 20),
  };

  const newsAgg = await pool.query(
    `SELECT symbol, COUNT(*)::int AS c
     FROM news_articles
     WHERE published_date >= NOW() - INTERVAL '7 days'
     GROUP BY symbol
     ORDER BY c DESC`
  );

  const totalNews = newsAgg.rows.reduce((sum: number, row: any) => sum + Number(row.c || 0), 0);
  const top = newsAgg.rows[0];
  const topShare = totalNews > 0 && top ? Number(top.c) / totalNews : 0;

  report.checks.news = {
    totalRows: totalNews,
    symbolDistribution: newsAgg.rows,
    topSymbol: top?.symbol || null,
    topShare,
    pass: topShare <= 0.3,
  };

  if (topShare > 0.3) {
    report.failedValidations.push({
      check: "news_symbol_concentration",
      condition: ">30% single symbol",
      observedTopShare: topShare,
      topSymbol: top?.symbol || null,
      totalNews,
    });
  }

  const ipoUpcoming = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM ipo_calendar
     WHERE event_date >= CURRENT_DATE - INTERVAL '7 days'`
  );
  report.checks.ipos = {
    upcomingOrRecentCount: Number(ipoUpcoming.rows[0]?.c || 0),
    pass: Number(ipoUpcoming.rows[0]?.c || 0) > 0,
  };
  if (!report.checks.ipos.pass) {
    report.failedValidations.push({
      check: "ipo_upcoming_dates",
      condition: "must have upcoming or recent dates",
      observed: 0,
    });
  }

  const splitsUpcoming = await pool.query(
    `SELECT COUNT(*)::int AS c FROM stock_splits WHERE event_date >= CURRENT_DATE - INTERVAL '7 days'`
  );
  report.checks.splits = {
    upcomingOrRecentCount: Number(splitsUpcoming.rows[0]?.c || 0),
    pass: Number(splitsUpcoming.rows[0]?.c || 0) > 0,
  };
  if (!report.checks.splits.pass) {
    report.failedValidations.push({
      check: "splits_upcoming_or_recent",
      condition: "must have upcoming or recent dates",
      observed: 0,
    });
  }

  report.ok = report.failedValidations.length === 0;

  ensureDir("logs/backtests");
  const reportPath = path.resolve(process.cwd(), "logs/backtests/report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${reportPath}`);

  if (!report.ok) {
    process.exitCode = 2;
  }
}

run()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
