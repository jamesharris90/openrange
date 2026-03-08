const db = require('../db');

function normalizeClass(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'A' || raw.endsWith(' A')) return 'A';
  if (raw === 'B' || raw.endsWith(' B')) return 'B';
  if (raw === 'C' || raw.endsWith(' C')) return 'C';
  return null;
}

async function runRadarEngine() {
  const result = await db.query(
    `SELECT *
     FROM strategy_signals
     WHERE updated_at >= NOW() - INTERVAL '15 minutes'`,
    []
  );

  const rows = Array.isArray(result?.rows) ? result.rows : [];

  const ranked = rows
    .filter((row) => Number(row?.score) >= 70)
    .sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));

  const radar = {
    A: [],
    B: [],
    C: [],
  };

  for (const row of ranked) {
    const cls = normalizeClass(row?.class);
    if (!cls) continue;
    radar[cls].push(row);
  }

  return radar;
}

module.exports = runRadarEngine;
