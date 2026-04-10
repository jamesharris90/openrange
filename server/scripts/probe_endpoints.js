const fs = require('fs');
const http = require('http');

const targets = [
  '/api/health',
  '/api/market/quotes?symbols=SPY,QQQ,AAPL',
  '/api/intelligence/watchlist?limit=20',
  '/',
  '/login',
];

function req(pathname) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(
      {
        host: '127.0.0.1',
        port: 3001,
        path: pathname,
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = null;
          }
          resolve({
            path: pathname,
            status: res.statusCode || 0,
            ms: Date.now() - started,
            contentType: String(res.headers['content-type'] || ''),
            isJson: parsed !== null,
            length: body.length,
            sample: body.slice(0, 140),
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });

    req.on('error', (err) => {
      resolve({
        path: pathname,
        status: 0,
        ms: Date.now() - started,
        error: String(err),
      });
    });
  });
}

async function main() {
  const results = [];
  for (const t of targets) {
    results.push(await req(t));
  }
  const out = {
    timestamp: new Date().toISOString(),
    results,
  };
  fs.writeFileSync('logs/endpoint_probe.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}

main();
