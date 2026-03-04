const fs = require('fs');
const path = require('path');

const root = process.cwd();
const ingestionLogPath = path.resolve(root, 'ingestion.log');
const intervalMs = 15000;

const PHASES = ['daily', 'intraday', 'earnings', 'news'];

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\n+/).filter(Boolean);
}

function summarize() {
  const lines = readLines(ingestionLogPath);

  const phases = Object.fromEntries(PHASES.map((phase) => [phase, {
    completedBatches: 0,
    totalBatches: 0,
    activeBatch: null,
  }]));

  let lastEvent = null;
  let lastTs = null;

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      lastEvent = event;
      if (event.ts) lastTs = event.ts;

      for (const phase of PHASES) {
        if (event.event === `${phase}.batch_start`) {
          phases[phase].activeBatch = Number(event.batchIndex || 0) || null;
          phases[phase].totalBatches = Number(event.totalBatches || phases[phase].totalBatches || 0);
        }

        if (event.event === `${phase}.batch_done`) {
          phases[phase].completedBatches = Math.max(
            phases[phase].completedBatches,
            Number(event.batchIndex || 0),
          );
        }
      }
    } catch {}
  }

  const totals = PHASES.reduce((acc, phase) => {
    acc.completed += Number(phases[phase].completedBatches || 0);
    acc.total += Number(phases[phase].totalBatches || 0);
    return acc;
  }, { completed: 0, total: 0 });

  const completedPct = totals.total > 0 ? Number(((totals.completed / totals.total) * 100).toFixed(2)) : 0;
  const remainingPct = Number((100 - completedPct).toFixed(2));

  return {
    now: new Date().toISOString(),
    completedPct,
    remainingPct,
    completedBatches: totals.completed,
    totalBatches: totals.total,
    lastEvent: lastEvent?.event || null,
    lastEventTs: lastTs,
    phases,
  };
}

function tick() {
  const summary = summarize();
  console.log(JSON.stringify({ event: 'ingestion.percent', ...summary }));
}

tick();
setInterval(tick, intervalMs);
