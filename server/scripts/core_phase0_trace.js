const fs = require('fs');
const path = require('path');
const http = require('http');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { pool } = require('../db/pg');

function getJson(pathname, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    const req = http.get({ host: '127.0.0.1', port: 3001, path: pathname, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => {
        body += d;
      });
      res.on('end', () => {
        if (done) return;
        done = true;
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode || 0, ms: Date.now() - started, json, body });
      });
    });
    req.on('timeout', () => {
      if (done) return;
      done = true;
      req.destroy(new Error('timeout'));
      resolve({ status: 0, ms: Date.now() - started, json: null, body: '' });
    });
    req.on('error', (error) => {
      if (done) return;
      done = true;
      resolve({ status: 0, ms: Date.now() - started, json: null, body: '', error: String(error) });
    });
  });
}

function countNull(items, key) {
  let nulls = 0;
  for (const item of items || []) {
    if (item == null || item[key] == null) nulls += 1;
  }
  return nulls;
}

async function main() {
  const dbResult = await pool.query(
    `SELECT symbol, price, change_percent, avg_volume_30d
     FROM market_metrics
     LIMIT 20`
  );
  const dbRows = dbResult.rows || [];

  const quotes = await getJson('/api/market/quotes?symbols=SPY,QQQ,AAPL', 20000);
  const top = await getJson('/api/intelligence/top-opportunities?limit=20', 90000);

  const quoteRows = Array.isArray(quotes.json?.data) ? quotes.json.data : [];
  const topRows = Array.isArray(top.json?.data) ? top.json.data : [];

  const trace = {
    timestamp: new Date().toISOString(),
    db: {
      row_count: dbRows.length,
      sample: dbRows,
      change_percent_nulls: countNull(dbRows, 'change_percent'),
    },
    quotes_api: {
      status: quotes.status,
      latency_ms: quotes.ms,
      row_count: quoteRows.length,
      sample: quoteRows,
      change_percent_nulls: countNull(quoteRows, 'change_percent'),
    },
    intelligence_top_opportunities: {
      status: top.status,
      latency_ms: top.ms,
      row_count: topRows.length,
      sample: topRows,
      change_percent_nulls: countNull(topRows, 'change_percent'),
    },
  };

  fs.writeFileSync('/Users/jamesharris/Server/logs/change_percent_trace.json', JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({
    db_nulls: trace.db.change_percent_nulls,
    quotes_nulls: trace.quotes_api.change_percent_nulls,
    top_nulls: trace.intelligence_top_opportunities.change_percent_nulls,
    top_latency_ms: trace.intelligence_top_opportunities.latency_ms,
    top_status: trace.intelligence_top_opportunities.status,
  }));

  await pool.end();
}

main().catch(async (error) => {
  fs.writeFileSync('/Users/jamesharris/Server/logs/change_percent_trace.json', JSON.stringify({ timestamp: new Date().toISOString(), error: String(error) }, null, 2));
  try { await pool.end(); } catch {}
  process.exit(1);
});
