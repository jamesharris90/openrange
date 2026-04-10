const fs = require('fs');
const http = require('http');

function callWatchlist(runIndex) {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;

    const req = http.get(
      {
        host: '127.0.0.1',
        port: 3001,
        path: '/api/intelligence/watchlist?limit=30',
        timeout: 4000,
      },
      (res) => {
        let body = '';
        res.on('data', (d) => {
          body += d;
        });
        res.on('end', () => {
          if (done) return;
          done = true;
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = null;
          }
          const count = parsed && Array.isArray(parsed.data) ? parsed.data.length : 0;
          resolve({
            run: runIndex,
            status: res.statusCode || 0,
            response_time_ms: Date.now() - started,
            count,
            timeout: false,
          });
        });
      }
    );

    req.on('timeout', () => {
      if (done) return;
      done = true;
      req.destroy(new Error('timeout'));
      resolve({
        run: runIndex,
        status: 0,
        response_time_ms: Date.now() - started,
        count: 0,
        timeout: true,
      });
    });

    req.on('error', (error) => {
      if (done) return;
      done = true;
      resolve({
        run: runIndex,
        status: 0,
        response_time_ms: Date.now() - started,
        count: 0,
        timeout: true,
        error: String(error),
      });
    });
  });
}

async function main() {
  const runs = [];
  for (let i = 1; i <= 3; i += 1) {
    runs.push(await callWatchlist(i));
  }

  const pass = runs.every(
    (r) => r.status === 200 && r.response_time_ms < 2000 && !r.timeout && r.count >= 5
  );

  const out = {
    timestamp: new Date().toISOString(),
    runs,
    pass,
  };

  fs.writeFileSync('/Users/jamesharris/Server/logs/phase2_watchlist_validation.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}

main();
