const fs = require('fs');

const p = 'ingestion.log';
const lines = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split(/\n+/).filter(Boolean) : [];

let startTs = null;
let lastDoneTs = null;
let completedBatches = 0;
let lastEvent = null;

for (const line of lines) {
  try {
    const event = JSON.parse(line);
    if (event.event === 'ingestion.start' && !startTs) {
      startTs = Date.parse(event.ts);
    }
    if (/\.batch_done$/.test(String(event.event || ''))) {
      completedBatches += 1;
      lastDoneTs = Date.parse(event.ts);
    }
    lastEvent = event;
  } catch {}
}

const universe = 5120;
const totalExpectedBatches = Math.ceil(universe / 40) + Math.ceil(universe / 15) + Math.ceil(universe / 40) + Math.ceil(universe / 50);
const remainingBatches = Math.max(0, totalExpectedBatches - completedBatches);

let batchesPerMin = null;
let etaMinutes = null;

if (startTs && lastDoneTs && lastDoneTs > startTs && completedBatches > 0) {
  const elapsedMinutes = (lastDoneTs - startTs) / 60000;
  batchesPerMin = completedBatches / elapsedMinutes;
  if (batchesPerMin > 0) {
    etaMinutes = remainingBatches / batchesPerMin;
  }
}

const completedPercent = Number(((completedBatches / totalExpectedBatches) * 100).toFixed(2));
const remainingPercent = Number((100 - completedPercent).toFixed(2));

console.log(JSON.stringify({
  universe,
  totalExpectedBatches,
  completedBatches,
  remainingBatches,
  completedPercent,
  remainingPercent,
  batchesPerMin: batchesPerMin ? Number(batchesPerMin.toFixed(3)) : null,
  etaMinutes: etaMinutes ? Number(etaMinutes.toFixed(1)) : null,
  lastEvent: lastEvent?.event || null,
  lastEventTs: lastEvent?.ts || null,
}, null, 2));
