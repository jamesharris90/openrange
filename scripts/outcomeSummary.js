const fs = require('fs');
const path = require('path');

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function run() {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    console.log({ total: 0, wins: 0, win_rate: 0, winners_positive_15m: true, losers_identifiable_early: true });
    return;
  }

  const files = fs.readdirSync(logsDir).filter((f) => f.startsWith('outcome_') && f.endsWith('.json'));

  let all = [];
  for (const file of files) {
    const parsed = safeReadJson(path.join(logsDir, file));
    if (Array.isArray(parsed)) all = all.concat(parsed);
  }

  const wins = all.filter((x) => x?.outcome === 'WINNER').length;
  const losers = all.filter((x) => x?.outcome === 'LOSER');
  const total = all.length;

  const winnersPositive15m = all
    .filter((x) => x?.outcome === 'WINNER')
    .every((x) => {
      const move = asNumber(x?.move_15m);
      return Number.isFinite(move) && move > 0;
    });

  const losersIdentifiableEarly = losers.every((x) => {
    const m5 = asNumber(x?.move_5m);
    const m15 = asNumber(x?.move_15m);
    return (Number.isFinite(m5) && m5 < 0) || (Number.isFinite(m15) && m15 < 0);
  });

  const summary = {
    total,
    wins,
    win_rate: total > 0 ? Number((wins / total).toFixed(4)) : 0,
    winners_positive_15m: winnersPositive15m,
    losers_identifiable_early: losersIdentifiableEarly,
  };

  console.log(summary);
}

run();
