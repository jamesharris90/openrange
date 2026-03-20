const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../../logs/trade-outcomes.json');
const OUT = path.join(__dirname, '../../logs/backtest-results.json');

function runBacktest() {
  if (!fs.existsSync(FILE)) return;

  const trades = JSON.parse(fs.readFileSync(FILE));

  const result = trades.reduce((acc, t) => {
    if (t.outcome === 'win') acc.pnl += 1;
    if (t.outcome === 'loss') acc.pnl -= 1;
    return acc;
  }, { pnl: 0 });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ...result, timestamp: new Date().toISOString() }, null, 2));

  console.log('[BACKTEST RESULT]', result);
}

module.exports = { runBacktest };
