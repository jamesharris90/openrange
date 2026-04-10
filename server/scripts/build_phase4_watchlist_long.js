const fs = require('fs');
const http = require('http');

function requestJson(url) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(url, { timeout: 300000 }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode || 0, text, json, ms: Date.now() - started });
      });
    });

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ status: 0, text: String(err), json: null, ms: Date.now() - started }));
  });
}

async function main() {
  const response = await requestJson('http://127.0.0.1:3001/api/intelligence/watchlist?limit=80');
  const rows = response.json && Array.isArray(response.json.data) ? response.json.data : [];

  const distribution = {};
  for (const row of rows) {
    const reason = String((row && row.watch_reason) || 'UNKNOWN').toUpperCase();
    distribution[reason] = (distribution[reason] || 0) + 1;
  }

  const count = rows.length;
  const highVolPct = count ? Math.round(((distribution.HIGH_VOLATILITY || 0) * 10000) / count) / 100 : 0;

  const out = {
    timestamp: new Date().toISOString(),
    latency_ms: response.ms,
    status: response.status,
    count,
    distribution,
    high_volatility_percent: highVolPct,
    has_earnings: (distribution.EARNINGS_UPCOMING || 0) > 0,
    has_news: (distribution.NEWS_PENDING || 0) > 0,
    has_large_move: (distribution.LARGE_MOVE || 0) > 0,
    sample: rows.slice(0, 10),
    error: response.status === 0 ? response.text : null,
  };

  out.pass =
    out.status === 200 &&
    out.high_volatility_percent < 80 &&
    (out.has_earnings || out.has_news || out.has_large_move);

  fs.writeFileSync('logs/go_live_phase4_watchlist.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ status: out.status, latency_ms: out.latency_ms, count: out.count, high_volatility_percent: out.high_volatility_percent, pass: out.pass }));
}

main();
