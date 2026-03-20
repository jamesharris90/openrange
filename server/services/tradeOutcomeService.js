const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../../logs/trade-outcomes.json');

function load() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE));
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function recordOutcome(trade) {
  const data = load();

  data.push({
    symbol: trade.symbol,
    strategy: trade.strategy,
    entry: trade.entry,
    stop: trade.stop_loss,
    target: trade.take_profit,
    confidence: trade.confidence_context_percent,
    timestamp: new Date().toISOString(),
    outcome: 'pending'
  });

  save(data);
}

module.exports = { recordOutcome };
