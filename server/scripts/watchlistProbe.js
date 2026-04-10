const fs = require('fs');

async function main() {
  const r = await fetch('http://127.0.0.1:3001/api/intelligence/watchlist?limit=80');
  const j = await r.json().catch(() => ({}));
  const rows = Array.isArray(j?.data) ? j.data : [];
  const dist = {};
  for (const row of rows) {
    const key = String(row?.watch_reason || 'UNKNOWN').toUpperCase();
    dist[key] = (dist[key] || 0) + 1;
  }

  const total = rows.length;
  const highVol = total ? Number((((dist.HIGH_VOLATILITY || 0) / total) * 100).toFixed(2)) : 0;
  const out = {
    timestamp: new Date().toISOString(),
    status: r.status,
    count: total,
    distribution: dist,
    high_volatility_percent: highVol,
    has_earnings: Boolean(dist.EARNINGS_UPCOMING),
    has_news: Boolean(dist.NEWS_PENDING),
    has_large_move: Boolean(dist.LARGE_MOVE),
  };
  out.pass = r.status === 200
    && out.high_volatility_percent < 80
    && (out.has_earnings || out.has_news || out.has_large_move);

  fs.writeFileSync('/Users/jamesharris/Server/logs/go_live_phase4_watchlist.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  fs.writeFileSync('/Users/jamesharris/Server/logs/go_live_phase4_watchlist.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    status: 0,
    pass: false,
    error: error.message,
  }, null, 2));
  console.error(error.message);
  process.exit(1);
});
