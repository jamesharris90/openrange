const fs = require('fs');
const path = require('path');

const root = process.cwd();
const ingestionLogPath = path.resolve(root, 'ingestion.log');
const milestoneLogPath = path.resolve(root, 'ingestion-milestones.log');
const statePath = path.resolve(root, '.ingestion-milestone-state.json');
const intervalMs = 15000;

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\n+/).filter(Boolean);
}

function getProgress() {
  const lines = readJsonLines(ingestionLogPath);
  const phases = ['daily', 'intraday', 'earnings', 'news'];
  const progress = Object.fromEntries(phases.map((phase) => [phase, { done: 0, total: 0 }]));
  let lastEvent = null;

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      lastEvent = event;
      for (const phase of phases) {
        if (event.event === `${phase}.batch_start`) {
          progress[phase].total = Number(event.totalBatches || progress[phase].total || 0);
        }
        if (event.event === `${phase}.batch_done`) {
          progress[phase].done = Math.max(progress[phase].done, Number(event.batchIndex || 0));
        }
      }
    } catch {}
  }

  const totals = phases.reduce((acc, phase) => {
    acc.done += progress[phase].done;
    acc.total += progress[phase].total;
    return acc;
  }, { done: 0, total: 0 });

  const percent = totals.total > 0 ? (totals.done / totals.total) * 100 : 0;
  return {
    percent,
    roundedPercent: Number(percent.toFixed(2)),
    done: totals.done,
    total: totals.total,
    phase: lastEvent?.event || null,
  };
}

function loadState() {
  if (!fs.existsSync(statePath)) return { lastBucket: -1 };
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return { lastBucket: -1 };
  }
}

function saveState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
}

function appendMilestone(entry) {
  fs.appendFileSync(milestoneLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
  console.log(JSON.stringify(entry));
}

function runTick() {
  const state = loadState();
  const progress = getProgress();
  const bucket = Math.floor(progress.roundedPercent / 10) * 10;

  if (bucket >= 0 && bucket <= 100 && bucket > Number(state.lastBucket || -1)) {
    const payload = {
      ts: new Date().toISOString(),
      event: 'ingestion.milestone',
      milestonePercent: bucket,
      overallPercent: progress.roundedPercent,
      completedBatches: progress.done,
      totalBatches: progress.total,
      phase: progress.phase,
    };
    appendMilestone(payload);
    saveState({ lastBucket: bucket });
  }

  if (progress.roundedPercent >= 100) {
    process.exit(0);
  }
}

runTick();
setInterval(runTick, intervalMs);
