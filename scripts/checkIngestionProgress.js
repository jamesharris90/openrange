const fs = require('fs');
const path = require('path');

const logPath = path.resolve(process.cwd(), 'ingestion.log');
if (!fs.existsSync(logPath)) {
  console.log(JSON.stringify({ ok: false, reason: 'log_missing', logPath }));
  process.exit(1);
}

const lines = fs.readFileSync(logPath, 'utf8').split(/\n+/).filter(Boolean);
const PHASES = ['daily', 'intraday', 'earnings', 'news'];
const progress = Object.fromEntries(PHASES.map((phase) => [phase, {
  completedBatches: 0,
  totalBatches: 0,
  percent: 0,
  activeBatch: null,
}]));

let lastEvent = null;

for (const line of lines) {
  try {
    const event = JSON.parse(line);
    lastEvent = event;

    for (const phase of PHASES) {
      if (event.event === `${phase}.batch_start`) {
        progress[phase].activeBatch = Number(event.batchIndex || 0) || null;
        progress[phase].totalBatches = Number(event.totalBatches || 0);
      }

      if (event.event === `${phase}.batch_done`) {
        progress[phase].completedBatches = Math.max(
          progress[phase].completedBatches,
          Number(event.batchIndex || 0),
        );
      }
    }
  } catch {}
}

for (const phase of PHASES) {
  const completed = Number(progress[phase].completedBatches || 0);
  const total = Number(progress[phase].totalBatches || 0);
  progress[phase].percent = total > 0
    ? Number(((completed / total) * 100).toFixed(2))
    : 0;
}

const totals = PHASES.reduce((acc, phase) => {
  acc.completed += Number(progress[phase].completedBatches || 0);
  acc.total += Number(progress[phase].totalBatches || 0);
  return acc;
}, { completed: 0, total: 0 });

const overallPercent = totals.total > 0
  ? Number(((totals.completed / totals.total) * 100).toFixed(2))
  : 0;

console.log(JSON.stringify({
  ok: true,
  lines: lines.length,
  phase: lastEvent?.event || null,
  overall: {
    completedBatches: totals.completed,
    totalBatches: totals.total,
    percent: overallPercent,
  },
  phases: progress,
  lastEvent,
}, null, 2));
